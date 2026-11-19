"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/app/components/wallet-button";
import { Eyebrow } from "@/app/components/eyebrow";
import { CommitmentSlip } from "@/app/components/commitment-slip";
import { useProgram } from "@/lib/use-program";
import { teamPda } from "@/lib/anchor";
import { describeTxError, sendWithPhases, type TxPhase } from "@/lib/send-tx";
import { useDisplayNames, displayNameOrShort } from "@/lib/use-display-names";

// The invite "code" is the challenge account's own base58 address -- every
// other account (vault, teams, members) derives from it, so no separate
// invite-code-to-challenge lookup table is needed.
type ChallengeView = {
  title: string;
  stakeLamports: number;
  target: number;
  teamAName: string;
  teamBName: string;
  settled: boolean;
  deadlineUnix: number;
  // Captured when this load resolved, purely to compare against
  // deadlineUnix -- not used for anything that needs to be live/ticking.
  loadedAtMs: number;
};

export function JoinClient({ code }: { code: string }) {
  const { publicKey } = useWallet();
  return <JoinClientView key={code + (publicKey?.toBase58() ?? "disconnected")} code={code} />;
}

function JoinClientView({ code }: { code: string }) {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const [view, setView] = useState<ChallengeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamIndex, setTeamIndex] = useState<0 | 1 | null>(null);
  const [phase, setPhase] = useState<TxPhase | null>(null);
  // Bumped on every attempt and on Cancel, so a late wallet answer from an
  // abandoned attempt can't overwrite the current UI state.
  const attempt = useRef(0);
  const [deposited, setDeposited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const myName = useDisplayNames(publicKey ? [publicKey.toBase58()] : []);

  const challengePk = useMemo(() => {
    try {
      return new PublicKey(code);
    } catch {
      return null;
    }
  }, [code]);

  useEffect(() => {
    if (!program || !challengePk) return;
    let cancelled = false;
    (async () => {
      try {
        const [challengeAcc, teamA, teamB] = await Promise.all([
          program.account.challenge.fetch(challengePk),
          program.account.team.fetch(teamPda(challengePk, 0)),
          program.account.team.fetch(teamPda(challengePk, 1)),
        ]);
        if (cancelled) return;
        setView({
          title: `${teamA.name} vs ${teamB.name}`,
          stakeLamports: challengeAcc.stakeLamports.toNumber(),
          target: challengeAcc.target,
          teamAName: teamA.name,
          teamBName: teamB.name,
          settled: challengeAcc.settled,
          deadlineUnix: challengeAcc.deadlineUnix.toNumber(),
          loadedAtMs: Date.now(),
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program, challengePk]);

  async function handleDeposit() {
    if (!program || !publicKey || !challengePk || teamIndex === null) return;
    const mine = ++attempt.current;
    setPhase("approve"); // lock the button now, before any await
    setError(null);
    try {
      const tx = await program.methods
        .joinTeam(teamIndex)
        .accounts({
          memberAuthority: publicKey,
          challenge: challengePk,
          team: teamPda(challengePk, teamIndex),
        })
        .transaction();
      tx.feePayer = publicKey;
      await sendWithPhases(connection, sendTransaction, tx, (p) => {
        if (attempt.current === mine) setPhase(p);
      });
      if (attempt.current !== mine) return;
      setDeposited(true);
      window.dispatchEvent(new Event("moltivate:updated"));
    } catch (err) {
      if (attempt.current !== mine) return;
      const message = describeTxError(err, program.idl.errors ?? []);
      // The deadline could have passed in the gap between loading this page
      // and submitting (or Phantom's own preflight simulation can reject
      // without a clean AnchorError at all -- see wallet-button.tsx's
      // comment on "Unexpected error" for another example of that). Try to
      // recognize this one specific case and say something a user can
      // actually act on; anything else falls back to the raw message.
      setError(
        message.includes("DeadlinePassed")
          ? "This challenge's deadline has already passed -- it's closed to new members."
          : message,
      );
    } finally {
      if (attempt.current === mine) setPhase(null);
    }
  }

  // Cancel only stops waiting: Phantom's pending request can't be withdrawn,
  // and approving it later still joins (the program allows one join per wallet).
  function cancelApproval() {
    attempt.current++;
    setPhase(null);
  }

  if (!challengePk) {
    return (
      <div className="app-page form-page">
        <p className="text-sm text-red-700 dark:text-red-300">
          That invite link doesn&apos;t look like a valid challenge address.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-page form-page">
        <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
      </div>
    );
  }

  if (!program) {
    return <section className="app-page form-page"><Eyebrow>Your people are waiting</Eyebrow><h1>You’re invited.<br /><em>Come on in.</em></h1><p className="page-intro">Connect your wallet to review the teams, goal, and devnet stake before joining.</p><WalletButton /><blockquote className="motivation">“Good things start with showing up.”</blockquote></section>;
  }

  if (!view) {
    return (
      <div className="app-page form-page">
        <p className="text-sm text-zinc-500">Loading challenge from devnet...</p>
      </div>
    );
  }

  const stakeSol = view.stakeLamports / 1_000_000_000;
  const deadlinePassed = view.loadedAtMs >= view.deadlineUnix * 1000;
  const closed = view.settled || deadlinePassed;

  return (
    <div className="app-page form-page">
      <Eyebrow>You&apos;re invited</Eyebrow>
      <h1 className="mb-8">Pick your people.<br /><em>Keep your word.</em></h1>
      <CommitmentSlip
        label="The challenge"
        value={view.title}
        detail={`${view.target} reps/week · stake ${stakeSol} SOL (devnet)`}
        signoff="see you there."
      />
      <p className="mt-3 mb-6 text-xs uppercase tracking-wide text-muted">
        Invite code: {code.slice(0, 4)}...{code.slice(-4)}
      </p>

      {closed ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {view.settled
            ? "This challenge has already been settled -- it's closed to new members."
            : "This challenge's deadline has already passed -- it's closed to new members."}
        </p>
      ) : !connected ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Connect your Phantom wallet to join.</p>
          <WalletButton />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connected as {publicKey ? displayNameOrShort(publicKey.toBase58(), myName) : ""}
          </p>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Pick a team</span>
            {([0, 1] as const).map((idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setTeamIndex(idx)}
                aria-pressed={teamIndex === idx}
                className={`rounded-2xl border px-5 py-5 text-left text-sm ${
                  teamIndex === idx ? "border-foreground bg-[#e8ecd9]" : "border-black/10 dark:border-white/15"
                }`}
              >
                {idx === 0 ? view.teamAName : view.teamBName}
              </button>
            ))}
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={teamIndex === null || phase !== null || deposited}
            onClick={handleDeposit}
            className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors disabled:opacity-50"
          >
            {deposited
              ? "Deposited"
              : phase === "approve"
                ? "Approve in Phantom…"
                : phase === "confirm"
                  ? "Confirming on devnet…"
                  : `Deposit ${stakeSol} SOL`}
          </button>
          {phase === "approve" && (
            <p className="text-xs text-zinc-500" role="status">
              No Phantom window? Open the Phantom extension.{" "}
              <button type="button" onClick={cancelApproval} className="underline">
                Cancel
              </button>
            </p>
          )}
          {deposited ? (
            <Link
              href={`/challenges/${code}`}
              className="rounded-full border border-black/10 px-5 py-2.5 text-center text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
            >
              Go to scoreboard
            </Link>
          ) : (
            <p className="text-xs text-zinc-500">
              Sends a real devnet transaction via your connected wallet.
            </p>
          )}
        </div>
      )}
      <blockquote className="motivation">“A promise feels better when you keep it together.”</blockquote>
    </div>
  );
}
