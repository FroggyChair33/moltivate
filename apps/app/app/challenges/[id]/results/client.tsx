"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { ClaimButton } from "@/app/components/claim-button";
import { Eyebrow } from "@/app/components/eyebrow";
import { useProgram } from "@/lib/use-program";
import { fetchChallengeMembers, teamPda, NO_WINNER } from "@/lib/anchor";
import { explorerTxUrl } from "@/lib/explorer";
import { useDisplayNames, displayNameOrShort } from "@/lib/use-display-names";

type MemberRow = {
  pubkey: string;
  owner: string;
  teamIndex: 0 | 1;
  payoutLamports: number;
  stakeLamports: number;
  claimed: boolean;
};

type Loaded = {
  teamAName: string;
  teamBName: string;
  settled: boolean;
  winningTeam: number;
  deadlineUnix: number;
  members: MemberRow[];
  // Captured when this load resolved, purely to render a "deadline hasn't
  // passed yet" hint - not used for anything that needs to be live/ticking.
  loadedAtMs: number;
  // Everything below is only used to prefill the "Rematch" button's link to
  // /challenges/new -- not otherwise displayed on this page.
  creator: string;
  oracle: string;
  stakeLamports: number;
  target: number;
};

export function ResultsClient({ id }: { id: string }) {
  const program = useProgram();
  const { publicKey } = useWallet();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleMessage, setSettleMessage] = useState<string | null>(null);
  const [settleSignature, setSettleSignature] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const names = useDisplayNames(state?.members.map((m) => m.owner) ?? []);

  useEffect(() => {
    if (!program) return;
    let cancelled = false;
    (async () => {
      try {
        const challengePk = new PublicKey(id);
        const teamAPk = teamPda(challengePk, 0);
        const teamBPk = teamPda(challengePk, 1);
        const [challengeAcc, teamA, teamB, memberAccs] = await Promise.all([
          program.account.challenge.fetch(challengePk),
          program.account.team.fetch(teamAPk),
          program.account.team.fetch(teamBPk),
          fetchChallengeMembers(program, challengePk),
        ]);
        if (cancelled) return;

        setState({
          teamAName: teamA.name,
          teamBName: teamB.name,
          settled: challengeAcc.settled,
          winningTeam: challengeAcc.winningTeam,
          deadlineUnix: challengeAcc.deadlineUnix.toNumber(),
          loadedAtMs: Date.now(),
          creator: challengeAcc.creator.toBase58(),
          oracle: challengeAcc.oracle.toBase58(),
          stakeLamports: challengeAcc.stakeLamports.toNumber(),
          target: challengeAcc.target,
          members: memberAccs.map((m) => ({
            pubkey: m.publicKey.toBase58(),
            owner: m.account.owner.toBase58(),
            teamIndex: (m.account.team as PublicKey).equals(teamAPk) ? 0 : 1,
            payoutLamports: m.account.payoutLamports.toNumber(),
            stakeLamports: m.account.stakeLamports.toNumber(),
            claimed: m.account.claimed,
          })),
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program, id, reloadKey]);

  async function handleSettleNow() {
    setSettling(true);
    setSettleMessage(null);
    setSettleSignature(null);
    try {
      const res = await fetch("/api/oracle/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: id }),
      });
      const data = await res.json();
      const result = data.results?.[0];
      if (!result) {
        setSettleMessage(`Unexpected response: ${JSON.stringify(data)}`);
      } else if (result.status === "settled") {
        setSettleMessage("Settled.");
        setSettleSignature(result.signature);
        setReloadKey((k) => k + 1);
      } else if (result.status === "already_settled") {
        setSettleMessage("Already settled.");
        setReloadKey((k) => k + 1);
      } else {
        setSettleMessage(`${result.status}: ${result.message ?? ""}`);
      }
    } catch (err) {
      setSettleMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSettling(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <p className="text-sm text-zinc-500">Loading results from devnet...</p>
      </div>
    );
  }

  const outcomeLabel = !state.settled
    ? "Not settled yet - the oracle hasn't called settle() for this challenge."
    : state.winningTeam === NO_WINNER
      ? "Settled: either both teams made goal (equal-split bonus from the group pot) or both fell short (forfeits went to the group pot)."
      : `Settled: ${state.winningTeam === 0 ? state.teamAName : state.teamBName} won.`;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <Eyebrow>{state.settled ? "Final results" : "Awaiting settlement"}</Eyebrow>
      <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        Challenge {id.slice(0, 4)}...{id.slice(-4)}
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        {state.teamAName} vs {state.teamBName} -- results
      </h1>

      <p className="mb-4 rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.06]">{outcomeLabel}</p>

      {state.settled && publicKey?.toBase58() === state.creator && (
        <div className="mb-8">
          <Link
            href={`/challenges/new?${new URLSearchParams({
              rematchOf: id,
              teamAName: state.teamAName,
              teamBName: state.teamBName,
              stakeSol: String(state.stakeLamports / 1_000_000_000),
              goalReps: String(state.target),
              oracle: state.oracle,
            }).toString()}`}
            className="w-fit rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
          >
            Rematch -- same group, new challenge
          </Link>
          <p className="mt-1 text-xs text-zinc-500">
            Only you (the creator) see this -- it prefills a new challenge with the same
            teams, stake, and goal. The group pot carries forward automatically since
            it&apos;s tied to your wallet. Make sure you&apos;ve claimed your own payout first
            if you need it to fund the new stake.
          </p>
        </div>
      )}

      {!state.settled && (
        <div className="mb-8 flex flex-col gap-2">
          <p className="text-xs text-zinc-500">
            Deadline: {new Date(state.deadlineUnix * 1000).toLocaleString()}
            {state.loadedAtMs < state.deadlineUnix * 1000 && " (hasn't passed yet - settle will fail on-chain until it does)"}
          </p>
          <button
            type="button"
            disabled={settling}
            onClick={handleSettleNow}
            className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {settling ? "Settling..." : "Settle now"}
          </button>
          {settleMessage && (
            <p className="text-xs text-zinc-500">
              {settleMessage}
              {settleSignature && (
                <>
                  {" "}
                  <a
                    href={explorerTxUrl(settleSignature)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    View on Solana Explorer
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-6">
        {[0, 1].map((idx) => (
          <div key={idx}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {idx === 0 ? state.teamAName : state.teamBName}
            </h2>
            <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
              {state.members
                .filter((m) => m.teamIndex === idx)
                .map((member) => (
                  <div key={member.pubkey} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{displayNameOrShort(member.owner, names)}</p>
                      <p className="text-xs text-zinc-500">
                        {state.settled
                          ? `payout ${(member.payoutLamports / 1_000_000_000).toFixed(4)} SOL (staked ${(member.stakeLamports / 1_000_000_000).toFixed(4)})`
                          : `staked ${(member.stakeLamports / 1_000_000_000).toFixed(4)} SOL`}
                      </p>
                    </div>
                    {state.settled && (
                      <ClaimButton
                        challenge={id}
                        teamMember={member.pubkey}
                        owner={member.owner}
                        alreadyClaimed={member.claimed}
                      />
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
