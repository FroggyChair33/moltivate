"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/app/components/wallet-button";
import { useProgram } from "@/lib/use-program";
import { teamPda } from "@/lib/anchor";

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
};

export function JoinClient({ code }: { code: string }) {
  const { connected, publicKey } = useWallet();
  const program = useProgram();

  const [view, setView] = useState<ChallengeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamIndex, setTeamIndex] = useState<0 | 1 | null>(null);
  const [depositing, setDepositing] = useState(false);
  const [deposited, setDeposited] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setDepositing(true);
    setError(null);
    try {
      await program.methods
        .joinTeam(teamIndex)
        .accounts({
          memberAuthority: publicKey,
          challenge: challengePk,
          team: teamPda(challengePk, teamIndex),
        })
        .rpc();
      setDeposited(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDepositing(false);
    }
  }

  if (!challengePk) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-12">
        <p className="text-sm text-red-700 dark:text-red-300">
          That invite link doesn&apos;t look like a valid challenge address.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-12">
        <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-12">
        <p className="text-sm text-zinc-500">Loading challenge from devnet...</p>
      </div>
    );
  }

  const stakeSol = view.stakeLamports / 1_000_000_000;

  return (
    <div className="mx-auto w-full max-w-md px-6 py-12">
      <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        Invite code: {code.slice(0, 4)}...{code.slice(-4)}
      </p>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{view.title}</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {view.target} reps/week &middot; stake {stakeSol} SOL (devnet)
      </p>

      {!connected ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Connect your Phantom wallet to join.</p>
          <WalletButton />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connected as {publicKey?.toBase58().slice(0, 4)}...
            {publicKey?.toBase58().slice(-4)}
          </p>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Pick a team</span>
            {([0, 1] as const).map((idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setTeamIndex(idx)}
                className={`rounded-lg border px-4 py-2 text-left text-sm ${
                  teamIndex === idx ? "border-foreground" : "border-black/10 dark:border-white/15"
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
            disabled={teamIndex === null || depositing || deposited}
            onClick={handleDeposit}
            className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors disabled:opacity-50"
          >
            {deposited ? "Deposited" : depositing ? "Depositing..." : `Deposit ${stakeSol} SOL`}
          </button>
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
    </div>
  );
}
