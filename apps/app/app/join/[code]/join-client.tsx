"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/app/components/wallet-button";
import { Eyebrow } from "@/app/components/eyebrow";
import { CommitmentSlip } from "@/app/components/commitment-slip";
import { useProgram } from "@/lib/use-program";
import { getReadProgram, memberPda, teamPda } from "@/lib/anchor";
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
  const [notice, setNotice] = useState<string | null>(null);
  const myName = useDisplayNames(publicKey ? [publicKey.toBase58()] : []);

  // Challenge details load without a wallet, so a visitor sees what they're
  // invited to (and whether it's closed) before connecting.
  const reader = useMemo(() => getReadProgram(connection), [connection]);

  const challengePk = useMemo(() => {
    try {
      return new PublicKey(code);
    } catch {
      return null;
    }
  }, [code]);

  useEffect(() => {
    if (!challengePk) return;
    let cancelled = false;
    (async () => {
      try {
        const [challengeAcc, teamA, teamB] = await Promise.all([
          reader.account.challenge.fetch(challengePk),
          reader.account.team.fetch(teamPda(challengePk, 0)),
          reader.account.team.fetch(teamPda(challengePk, 1)),
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
  }, [reader, challengePk]);

  function markJoined(late: boolean) {
    attempt.current++; // a newer attempt in flight can only fail now
    setPhase(null);
    setError(null);
    setDeposited(true);
    if (late) setNotice("Your earlier request went through. You're on the team.");
    window.dispatchEvent(new Event("moltivate:updated"));
  }

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
      // Landed after Cancel? You did join: show it rather than drop it.
      markJoined(attempt.current !== mine);
    } catch (err) {
      if (attempt.current !== mine) return;
      // A retry fails if a cancelled approval already joined this wallet.
      if (await reader.account.teamMember.fetchNullable(memberPda(challengePk, publicKey)).catch(() => null)) {
        return markJoined(true);
      }
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

  // Cancel only stops waiting: Phantom's pending request can't be withdrawn.
  // If it's approved later, markJoined reports it (one join per wallet).
  function cancelApproval() {
    attempt.current++;
    setPhase(null);
  }

  if (!challengePk) {
    return (
      <div className="app-page form-page">
        <p className="text-sm text-red-300">
          That invite link doesn&apos;t look like a valid challenge address.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-page form-page">
        <p className="text-sm text-red-300">{loadError}</p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="app-page form-page">
        <p className="text-sm text-muted">Loading challenge from devnet...</p>
      </div>
    );
  }

  const stakeSol = view.stakeLamports / 1_000_000_000;
  const deadlinePassed = view.loadedAtMs >= view.deadlineUnix * 1000;
  const closed = view.settled || deadlinePassed;

  return (
    <div className="app-page form-page">
      <Eyebrow>You&apos;re invited</Eyebrow>
      <h1 className="mb-8">Join this challenge</h1>
      <CommitmentSlip
        label="The challenge"
        value={view.title}
        detail={`${view.target} reps/week · stake ${stakeSol} SOL (devnet)`}
      />
      <p className="mt-3 mb-6 text-xs uppercase tracking-wide text-muted">
        Invite code: {code.slice(0, 4)}...{code.slice(-4)}
      </p>

      {closed ? (
        <p className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">
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
          <p className="text-sm text-muted">
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
                  teamIndex === idx ? "border-accent bg-accent/15" : "border-line"
                }`}
              >
                {idx === 0 ? view.teamAName : view.teamBName}
              </button>
            ))}
          </div>

          {error && (
            <p className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">
              {error}
            </p>
          )}
          {notice && <p className="rounded-lg bg-accent/15 p-3 text-sm" role="status">{notice}</p>}

          <button
            type="button"
            disabled={teamIndex === null || phase !== null || deposited}
            onClick={handleDeposit}
            className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-colors disabled:opacity-50"
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
            <p className="text-xs text-muted" role="status">
              No Phantom window? Open the Phantom extension.{" "}
              <button type="button" onClick={cancelApproval} className="underline">
                Cancel
              </button>
            </p>
          )}
          {deposited ? (
            <Link
              href={`/challenges/${code}`}
              className="rounded-full border border-line px-5 py-2.5 text-center text-sm font-medium transition-colors hover:bg-white/[.06]"
            >
              Go to scoreboard
            </Link>
          ) : (
            <p className="text-xs text-muted">
              Sends a real devnet transaction via your connected wallet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
