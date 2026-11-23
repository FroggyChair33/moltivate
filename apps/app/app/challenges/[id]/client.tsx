"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAccount } from "@/app/components/account-provider";
import { RollingNumber } from "@/app/components/rolling-number";
import { MediaPipeSquatSession } from "@/app/components/mediapipe-squat-session";
import { Eyebrow } from "@/app/components/eyebrow";
import { fetchChallengeMembers, getReadProgram, teamPda } from "@/lib/anchor";
import { useDisplayNames, displayNameOrShort } from "@/lib/use-display-names";

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
  // Evaluated on each 5s refresh, so it can lag the real deadline by a few seconds.
  deadlinePassed: boolean;
  teamAName: string;
  teamBName: string;
  members: MemberRow[];
  updatedAt: string;
};

// "You" is the account's linked wallets, not the connected one: a phone has none connected.
export function ChallengeScoreboardClient({ id }: { id: string }) {
  const { me } = useAccount();
  const wallets = me?.wallets ?? [];
  return <ChallengeScoreboardClientView key={id + wallets.join(",")} id={id} wallets={wallets} />;
}

function ChallengeScoreboardClientView({ id, wallets }: { id: string; wallets: string[] }) {
  const { connection } = useConnection();
  const program = useMemo(() => getReadProgram(connection), [connection]);
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // window.location.origin isn't available during SSR -- read it only after
  // mount (same hydration-mismatch concern as WalletButton) so this never
  // disagrees with the server-rendered markup.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const names = useDisplayNames(state?.members.map((m) => m.owner) ?? []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!program) return;
    let cancelled = false;
    let loading = false;
    const controller = new AbortController();
    async function refresh() {
      if (!program || loading || document.visibilityState === "hidden") return;
      loading = true;
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
          const res = await fetch(`/api/workout-sessions/totals?challengePubkey=${id}`, { cache: "no-store", signal: controller.signal });
          if (!res.ok) throw new Error("Workout totals are temporarily unavailable. Please retry.");
          const data = await res.json();
          if (!data.totals || typeof data.totals !== "object" || Array.isArray(data.totals) || Object.values(data.totals).some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
            throw new Error("Workout totals could not be read. Please retry.");
          }
          liveTotals = data.totals;
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

        if (cancelled) return;
        setError(null);
        setState({
          updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          title: `${teamA.name} vs ${teamB.name}`,
          target: challengeAcc.target,
          settled: challengeAcc.settled,
          deadlinePassed: Date.now() / 1000 >= challengeAcc.deadlineUnix.toNumber(),
          teamAName: teamA.name,
          teamBName: teamB.name,
          members,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("moltivate:updated", refresh);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("moltivate:updated", refresh);
    };
  }, [program, id, reloadKey]);

  if (error && !state) {
    return (
      <div className="app-page">
        <p role="alert" className="text-sm text-red-300">{error}</p>
        <button onClick={() => setReloadKey((key) => key + 1)} className="mt-4 underline">Retry</button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="app-page">
        <p className="text-sm text-muted">Loading challenge from devnet...</p>
      </div>
    );
  }

  // Half-workout units (see math::capped_workout_units) -> whole reps/workouts.
  const goalUnits = state.target * 2;
  const teams = [
    { index: 0 as const, name: state.teamAName, members: state.members.filter((m) => m.teamIndex === 0) },
    { index: 1 as const, name: state.teamBName, members: state.members.filter((m) => m.teamIndex === 1) },
  ]
    .map((team) => {
      const total = team.members.reduce((sum, m) => sum + m.countedUnits, 0);
      const goal = team.members.length * goalUnits;
      return { ...team, total, goal, percent: goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0 };
    })
    // Ranked leaderboard-style, like the marketing site's club board.
    .sort((a, b) => b.percent - a.percent || b.total - a.total);

  const myMember = state.members.find((m) => wallets.includes(m.owner));

  return (
    <div className="app-page">
      {error && <p role="alert" className="mb-4 text-sm text-red-300">Refresh failed. Showing the last loaded standings. <button className="underline" onClick={() => setReloadKey((key) => key + 1)}>Retry</button></p>}
      <Eyebrow>{state.settled ? "Challenge results" : "Live challenge"}</Eyebrow>
      <h1 className="mb-3">{state.title}</h1>
      <p className="mb-6 text-xs uppercase tracking-wide text-muted">
        {state.target} reps per member · Challenge {id.slice(0, 4)}...{id.slice(-4)}
        {!state.settled && " · progress below is live/unverified until settled"}
      </p>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface text-white">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
          <strong className="text-base font-semibold">Leaderboard</strong>
          <span className="text-xs text-[#a9bdd1]">
            <span>{state.settled ? "Final" : error ? "Update paused" : "Auto-updating"}</span> · {state.updatedAt}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-6 py-3 text-sm">
          <span className="min-w-0 flex-1 break-all select-all text-[#a9bdd1]">{origin}/join/{id}</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${origin}/join/${id}`);
                setCopied(true);
                setCopyError(false);
                setTimeout(() => setCopied(false), 2000);
              } catch { setCopyError(true); }
            }}
            className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-medium hover:bg-white/15"
          >
            {copied ? "Copied" : "Copy invite link"}
          </button>
        </div>

        {copyError && <p role="alert" className="px-6 py-3 text-xs">Could not copy automatically. Select the invite address above and copy it.</p>}
        <div className="flex flex-col divide-y divide-white/10">
          {teams.map((team, rank) => (
            <div key={team.index} className="board-row">
              <div className="board-main">
                <span className="font-mono text-sm text-[#a9bdd1]">{rank + 1}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{team.name}</p>
                  <p className="text-xs text-[#a9bdd1]">
                    {team.members.length} {team.members.length === 1 ? "member" : "members"}
                  </p>
                </div>
                <div className="board-detail">
                  <p className="board-score"><RollingNumber value={team.total / 2} /><span className="ml-1 text-xs text-[#a9bdd1]"> / {team.goal / 2} reps</span></p>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="board-progress h-full rounded-full bg-[#0496ff]" style={{ width: `${team.percent}%` }} />
                  </div>
                </div>
              </div>

              {team.members.length === 0 ? (
                <p className="mt-3 pl-8 text-xs text-[#a9bdd1]">No one has joined yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2 pl-8">
                  {team.members.map((member) => {
                    const pct = goalUnits > 0 ? Math.min(100, Math.round((member.countedUnits / goalUnits) * 100)) : 0;
                    return (
                      <li key={member.pubkey} className="flex items-center gap-3 text-xs">
                        <span className="min-w-0 flex-1 truncate text-[#dbe7f3]">
                          {displayNameOrShort(member.owner, names)}
                          {wallets.includes(member.owner) && <span className="text-[#8fd0ff]"> (you)</span>}
                        </span>
                        <span className="shrink-0 text-right text-[#a9bdd1]">
                          <RollingNumber value={member.countedUnits / 2} />/{goalUnits / 2} ({pct}%)
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>

        <p className="border-t border-white/10 px-6 py-4 text-xs leading-relaxed text-[#a9bdd1]">
          {state.settled
            ? "Final reps, converted from the settled on-chain half-rep units."
            : "Experimental standings, refreshed every 5 seconds. Live counts are unverified and don't establish payout eligibility until settled."}
        </p>
      </section>

      <div id="workout" className="mt-10 flex flex-col gap-6">
        {state.settled ? <p>This challenge has ended. Open results to review your claim.</p> : state.deadlinePassed ? (
          <p className="text-sm text-muted">The deadline has passed, so new workouts can&apos;t be recorded. Open results to settle and claim.</p>
        ) : myMember ? (
          <MediaPipeSquatSession challengePubkey={id} teamMemberPubkey={myMember.pubkey} />
        ) : wallets.length ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">You&apos;re not on a team in this challenge yet.</p>
            <Link href={`/join/${id}`} className="button-primary">Join a team</Link>
          </div>
        ) : (
          <p className="text-sm text-muted">
            <Link href="/account" className="underline">Link the wallet you joined with</Link> to log a workout.
          </p>
        )}
        <div>
          <Link
            href={`/challenges/${id}/results`}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:bg-white/[.06]"
          >
            View results / claim
          </Link>
        </div>
      </div>
    </div>
  );
}
