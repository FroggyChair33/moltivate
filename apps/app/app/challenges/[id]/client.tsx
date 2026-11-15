"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { LogSessionStub } from "@/app/components/log-session-stub";
import { MediaPipeSquatSession } from "@/app/components/mediapipe-squat-session";
import { useProgram } from "@/lib/use-program";
import { fetchChallengeMembers, teamPda } from "@/lib/anchor";

type MemberRow = {
  pubkey: string;
  owner: string;
  teamIndex: 0 | 1;
  countedUnits: number;
  claimed: boolean;
};

type Loaded = {
  title: string;
  target: number;
  settled: boolean;
  teamAName: string;
  teamBName: string;
  members: MemberRow[];
};

export function ChallengeScoreboardClient({ id }: { id: string }) {
  const program = useProgram();
  const { publicKey } = useWallet();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // window.location.origin isn't available during SSR -- read it only after
  // mount (same hydration-mismatch concern as WalletButton) so this never
  // disagrees with the server-rendered markup.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOrigin(window.location.origin), []);

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

        let liveTotals: Record<string, number> = {};
        if (!challengeAcc.settled) {
          // On-chain counted_units is 0 until settle() runs, so before that
          // the only way to show any progress at all is this live,
          // unverified preview read straight from logged sessions -- never
          // authoritative, settle() alone decides what actually gets paid.
          const res = await fetch(`/api/workout-sessions/totals?challengePubkey=${id}`);
          const data = await res.json().catch(() => ({}));
          liveTotals = data.totals ?? {};
        }

        const members: MemberRow[] = memberAccs.map((m) => {
          const pubkey = m.publicKey.toBase58();
          // Same cap as math::capped_workout_units, so the live preview
          // reads in the same units as the real post-settlement bar.
          const liveUnits = Math.min((liveTotals[pubkey] ?? 0) * 2, challengeAcc.target * 3);
          return {
            pubkey,
            owner: m.account.owner.toBase58(),
            teamIndex: (m.account.team as PublicKey).equals(teamAPk) ? 0 : 1,
            countedUnits: challengeAcc.settled ? m.account.countedUnits.toNumber() : liveUnits,
            claimed: m.account.claimed,
          };
        });

        setState({
          title: `${teamA.name} vs ${teamB.name}`,
          target: challengeAcc.target,
          settled: challengeAcc.settled,
          teamAName: teamA.name,
          teamBName: teamB.name,
          members,
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
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-sm text-zinc-500">Loading challenge from devnet...</p>
      </div>
    );
  }

  const teamAMembers = state.members.filter((m) => m.teamIndex === 0);
  const teamBMembers = state.members.filter((m) => m.teamIndex === 1);
  // Half-workout units (see math::capped_workout_units) -> whole reps/workouts.
  const goalUnits = state.target * 2;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        Challenge {id.slice(0, 4)}...{id.slice(-4)}
      </p>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{state.title}</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Goal: {state.target} workouts per member
        {state.settled ? " · settled" : " · progress below is live/unverified until settled"}
      </p>

      <div className="mb-8 flex items-center gap-2 rounded-lg bg-black/[.03] p-3 text-sm dark:bg-white/[.06]">
        <span className="min-w-0 flex-1 truncate text-zinc-500">{origin}/join/{id}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(`${origin}/join/${id}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="shrink-0 rounded-full border border-black/10 px-3 py-1 text-xs font-medium dark:border-white/15"
        >
          {copied ? "Copied" : "Copy invite link"}
        </button>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <TeamColumn name={state.teamAName} members={teamAMembers} goalUnits={goalUnits} />
        <TeamColumn name={state.teamBName} members={teamBMembers} goalUnits={goalUnits} />
      </div>

      <div className="mt-10 flex flex-col gap-6">
        {(() => {
          const myMember = state.members.find((m) => m.owner === publicKey?.toBase58());
          return myMember ? (
            <>
              <MediaPipeSquatSession challengePubkey={id} teamMemberPubkey={myMember.pubkey} />
              <LogSessionStub challengePubkey={id} teamMemberPubkey={myMember.pubkey} />
            </>
          ) : (
            <p className="text-sm text-zinc-500">
              Connect the wallet you joined with to log a workout.
            </p>
          );
        })()}
        <div>
          <Link
            href={`/challenges/${id}/results`}
            className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
          >
            View results / claim
          </Link>
        </div>
      </div>
    </div>
  );
}

function TeamColumn({ name, members, goalUnits }: { name: string; members: MemberRow[]; goalUnits: number }) {
  const total = members.reduce((sum, m) => sum + m.countedUnits, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{name}</h2>
        <span className="text-sm text-zinc-500">
          {total}/{members.length * goalUnits} units
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {members.length === 0 && <p className="text-sm text-zinc-500">No one has joined yet.</p>}
        {members.map((member) => {
          const pct = goalUnits > 0 ? Math.min(100, Math.round((member.countedUnits / goalUnits) * 100)) : 0;
          return (
            <div key={member.pubkey} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>
                  {member.owner.slice(0, 4)}...{member.owner.slice(-4)}
                </span>
                <span className="text-zinc-500">
                  {member.countedUnits}/{goalUnits}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
