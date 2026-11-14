"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ClaimButton } from "@/app/components/claim-button";
import { useProgram } from "@/lib/use-program";
import { fetchChallengeMembers, teamPda, NO_WINNER } from "@/lib/anchor";

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
  members: MemberRow[];
};

export function ResultsClient({ id }: { id: string }) {
  const program = useProgram();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [program, id]);

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
      <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        Challenge {id.slice(0, 4)}...{id.slice(-4)}
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        {state.teamAName} vs {state.teamBName} -- results
      </h1>

      <p className="mb-8 rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.06]">{outcomeLabel}</p>

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
                      <p className="text-sm font-medium">
                        {member.owner.slice(0, 4)}...{member.owner.slice(-4)}
                      </p>
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
