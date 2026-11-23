"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useAccount } from "@/app/components/account-provider";
import { LinkedWalletGate } from "@/app/components/linked-wallet-gate";
import { ClaimButton } from "@/app/components/claim-button";
import { Eyebrow } from "@/app/components/eyebrow";
import { fetchChallengeMembers, getReadProgram, teamPda, NO_WINNER } from "@/lib/anchor";
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
  stakeLamports: number;
  target: number;
};

// Reads and Close go through the account's linked wallets; only Claim needs the connected wallet.
export function ResultsClient({ id }: { id: string }) {
  const { me } = useAccount();
  const wallets = me?.wallets ?? [];
  return <ResultsClientView key={id + wallets.join(",")} id={id} wallets={wallets} />;
}

function ResultsClientView({ id, wallets }: { id: string; wallets: string[] }) {
  const { connection } = useConnection();
  const connected = useWallet().publicKey?.toBase58();
  const program = useMemo(() => getReadProgram(connection), [connection]);
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleMessage, setSettleMessage] = useState<string | null>(null);
  const [settleSignature, setSettleSignature] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const refresh = () => setReloadKey((key) => key + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("moltivate:updated", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("moltivate:updated", refresh); };
  }, []);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const names = useDisplayNames(state?.members.map((m) => m.owner) ?? []);

  useEffect(() => {
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

        setError(null);
        setState({
          teamAName: teamA.name,
          teamBName: teamB.name,
          settled: challengeAcc.settled,
          winningTeam: challengeAcc.winningTeam,
          deadlineUnix: challengeAcc.deadlineUnix.toNumber(),
          loadedAtMs: Date.now(),
          creator: challengeAcc.creator.toBase58(),
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/challenges/close?challenges=${id}`);
        if (!res.ok) throw new Error("Could not load challenge dismissal status.");
        const data = await res.json();
        if (!cancelled) {
          setClosed((data.closed ?? []).includes(id));
          setCloseError(null);
        }
      } catch {
        if (!cancelled) setCloseError("Could not refresh dismissal status. Retry to check it.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  async function handleClose() {
    setClosing(true);
    setCloseError(null);
    try {
      const res = await fetch("/api/challenges/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengePubkey: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Sign in again to close this challenge.");
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setClosed(true);
      window.dispatchEvent(new Event("moltivate:updated"));
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : String(err));
    } finally {
      setClosing(false);
    }
  }

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

  if (error && !state) {
    return (
      <div className="app-page form-page">
        <p role="alert" className="text-sm text-red-300">{error}</p>
        <button className="mt-4 underline" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="app-page form-page">
        <p className="text-sm text-muted">Loading results from devnet...</p>
      </div>
    );
  }

  const outcomeLabel = !state.settled
    ? "Not settled yet - the oracle hasn't called settle() for this challenge."
    : state.winningTeam === NO_WINNER
      ? "Settled: either both teams made goal (equal-split bonus from the group pot) or both fell short (forfeits went to the group pot)."
      : `Settled: ${state.winningTeam === 0 ? state.teamAName : state.teamBName} won.`;

  // Rematch is a create flow (the create page asks for the creator's connected wallet); Close needs only the account.
  const isCreator = wallets.includes(state.creator);
  const canClose = isCreator || state.members.some((m) => wallets.includes(m.owner));
  const allClaimed = state.members.length > 0 && state.members.every((m) => m.claimed);

  return (
    <div className="app-page form-page">
      <Eyebrow>{state.settled ? "Final results" : "Awaiting settlement"}</Eyebrow>
      <p className="mb-1 text-xs uppercase tracking-wide text-muted">
        Challenge {id.slice(0, 4)}...{id.slice(-4)}
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        {state.settled ? "Results" : "Results pending"}
      </h1>

      <p className="mb-4 result-panel text-sm">{outcomeLabel}</p>

      {state.settled && closed && (
        <p className="mb-8 rounded-lg border border-line p-3 text-sm text-muted">
          This challenge is closed. It won&apos;t show up as a &quot;current challenge&quot; or
          rematch suggestion anymore -- everyone already claimed, and nothing on-chain
          changes because of this.
        </p>
      )}

      {state.settled && !closed && isCreator && (
        <div className="mb-6">
          <Link
            href={`/challenges/new?${new URLSearchParams({
              rematchOf: id,
              teamAName: state.teamAName,
              teamBName: state.teamBName,
              stakeSol: String(state.stakeLamports / 1_000_000_000),
              goalReps: String(state.target),
            }).toString()}`}
            className="w-fit rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:bg-white/[.06]"
          >
            Rematch -- same group, new challenge
          </Link>
          <p className="mt-1 text-xs text-muted">
            Only you (the creator) see this -- it prefills a new challenge with the same
            teams, stake, and goal. The group pot carries forward automatically since
            it&apos;s tied to your wallet. Make sure you&apos;ve claimed your own payout first
            if you need it to fund the new stake.
          </p>
        </div>
      )}

      {state.settled && !closed && canClose && (
        <div className="mb-8">
          {allClaimed ? (
            <>
              <button
                type="button"
                disabled={closing}
                onClick={handleClose}
                className="w-fit rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:bg-white/[.06] disabled:opacity-50"
              >
                {closing ? "Closing..." : "Close challenge"}
              </button>
              <p className="mt-1 text-xs text-muted">
                Nobody wants a rematch? Everyone&apos;s claimed, so this is safe to close --
                it&apos;s a UI-only dismissal, not an on-chain action.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted">
              Close challenge becomes available once every member has claimed their payout.
            </p>
          )}
          {closeError && <p className="mt-1 text-xs text-red-300">{closeError}</p>}
        </div>
      )}

      {!state.settled && (
        <div className="mb-8 flex flex-col gap-2">
          <p className="text-xs text-muted">
            Deadline: {new Date(state.deadlineUnix * 1000).toLocaleString()}
            {state.loadedAtMs < state.deadlineUnix * 1000 && " (hasn't passed yet - settle will fail on-chain until it does)"}
          </p>
          <button
            type="button"
            disabled={settling}
            onClick={handleSettleNow}
            className="w-fit rounded-full bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {settling ? "Settling..." : "Settle now"}
          </button>
          {settleMessage && (
            <p className="text-xs text-muted">
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
          <div key={idx} className="result-panel">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              {idx === 0 ? state.teamAName : state.teamBName}
            </h2>
            <div className="flex flex-col divide-y divide-line">
              {state.members
                .filter((m) => m.teamIndex === idx)
                .map((member) => (
                  <div key={member.pubkey} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{displayNameOrShort(member.owner, names)}</p>
                      <p className="text-xs text-muted">
                        {state.settled
                          ? `payout ${(member.payoutLamports / 1_000_000_000).toFixed(4)} SOL (staked ${(member.stakeLamports / 1_000_000_000).toFixed(4)})`
                          : `staked ${(member.stakeLamports / 1_000_000_000).toFixed(4)} SOL`}
                      </p>
                    </div>
                    {state.settled && (() => {
                      const claim = <ClaimButton
                        challenge={id}
                        teamMember={member.pubkey}
                        owner={member.owner}
                        alreadyClaimed={member.claimed}
                      />;
                      // A linked or currently connected owner's unclaimed row signs, so it goes through the gate; other rows stay inert.
                      return !member.claimed && (wallets.includes(member.owner) || connected === member.owner) ? <LinkedWalletGate>{claim}</LinkedWalletGate> : claim;
                    })()}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
