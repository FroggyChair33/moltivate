"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { RollingNumber } from "@/app/components/rolling-number";
import { MediaPipeSquatSession } from "@/app/components/mediapipe-squat-session";
import { Eyebrow } from "@/app/components/eyebrow";
import { CommitmentSlip } from "@/app/components/commitment-slip";
import { useProgram } from "@/lib/use-program";
import { fetchChallengeMembers, teamPda } from "@/lib/anchor";
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
  teamAName: string;
  teamBName: string;
  members: MemberRow[];
  updatedAt: string;
};

export function ChallengeScoreboardClient({ id }: { id: string }) {
  const { publicKey } = useWallet();
  return <ChallengeScoreboardClientView key={id + (publicKey?.toBase58() ?? "disconnected")} id={id} />;
}

function ChallengeScoreboardClientView({ id }: { id: string }) {
  const program = useProgram();
  const { publicKey } = useWallet();
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

  if (!program) {
    return <section className="mx-auto w-full max-w-lg space-y-4 px-5 py-12">
      <h1 className="text-3xl">Connect to your challenge</h1>
      <p className="text-muted">Connect the wallet you created or joined with to load your devnet challenge.</p>
      <Link href="/" className="underline">Return to your challenges</Link>
    </section>;
  }

  if (error && !state) {
    return (
      <div className="app-page">
        <p role="alert" className="text-sm text-red-700">{error}</p>
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

  const myMember = state.members.find((m) => m.owner === publicKey?.toBase58());

  return (
    <div className="app-page">
      {error && <p role="alert" className="mb-4 text-sm text-red-700">Refresh failed. Showing the last loaded standings. <button className="underline" onClick={() => setReloadKey((key) => key + 1)}>Retry</button></p>}
      <Eyebrow>{state.settled ? "Challenge results" : "Your club, in motion"}</Eyebrow>
      <h1 className="mb-8">Show up for<br /><em>each other.</em></h1>
      <CommitmentSlip
        label="The challenge"
        value={state.title}
        detail={`${state.target} reps per member${state.settled ? " · settled" : ""}`}
      />
      <p className="mt-3 mb-6 text-xs uppercase tracking-wide text-muted">
        Challenge {id.slice(0, 4)}...{id.slice(-4)}
        {!state.settled && " · progress below is live/unverified until settled"}
      </p>

      <section className="overflow-hidden rounded-[22px] border border-[#2c4838] bg-[#132e23] text-[#f3f5e8] shadow-[0_20px_50px_rgba(24,60,37,0.25)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ecd17f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v5m-4 3h8m-6-3h4" />
            </svg>
            <strong className="text-base font-semibold tracking-tight">Leaderboard</strong>
          </div>
          <span className="rounded-md border border-[#455747] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#c1ccbd]">
            {state.settled ? "Final · devnet" : error ? "Update paused" : "Auto-updating"}
          </span>
        </div>

        <div className="board-meta"><span>{state.settled ? "Settled on-chain" : "Experimental rep standings · refreshes every 5s"}</span><span>Updated {state.updatedAt}</span></div>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-6 py-3 text-sm">
          <span className="min-w-0 flex-1 break-all select-all text-[#b9cdbf]">{origin}/join/{id}</span>
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
            className="shrink-0 rounded-full border border-[#455747] px-3 py-1 text-xs font-medium text-[#dcf0cf]"
          >
            {copied ? "Copied" : "Copy invite link"}
          </button>
        </div>

        {copyError && <p role="alert" className="px-6 py-3 text-xs">Could not copy automatically. Select the invite address above and copy it.</p>}
        <div className="flex flex-col divide-y divide-white/10">
          {teams.map((team, rank) => (
            <div key={team.index} className="board-row">
              <div className="board-main">
                <span className="w-6 font-mono text-xs text-[#90a78e]">{String(rank + 1).padStart(2, "0")}</span>
                <TeamAvatar name={team.name} teamIndex={team.index} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{team.name}</p>
                  <p className="text-xs text-[#93aa94]">
                    {team.members.length} {team.members.length === 1 ? "member" : "members"}
                  </p>
                </div>
                <div className="board-detail">
                  <p className="board-score"><RollingNumber value={team.total / 2} /><span className="ml-1 text-xs text-[#c2d1ba]"> / {team.goal / 2} reps</span></p>
                  <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[#38513f]">
                    <div className="board-progress h-full rounded-full bg-[#c7d785]" style={{ width: `${team.percent}%` }} />
                  </div>
                </div>
              </div>

              {team.members.length === 0 ? (
                <p className="mt-3 pl-9 text-xs text-[#93aa94]">No one has joined yet.</p>
              ) : (
                <div className="mt-4 flex flex-col gap-2.5 pl-9">
                  {team.members.map((member) => {
                    const pct = goalUnits > 0 ? Math.min(100, Math.round((member.countedUnits / goalUnits) * 100)) : 0;
                    return (
                      <div key={member.pubkey} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#78957a] font-mono text-[9px] text-[#132e23]">
                          {member.owner.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-[#dce7d5]">
                          {displayNameOrShort(member.owner, names)}
                          {member.owner === publicKey?.toBase58() && <span className="text-[#91a993]"> (you)</span>}
                        </span>
                        <span className="w-24 shrink-0 text-right text-xs text-[#91a993]">
                          <RollingNumber value={member.countedUnits / 2} />/{goalUnits / 2} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="border-t border-white/10 px-6 py-4 text-xs leading-relaxed text-[#bdcbb3]">
          {state.settled
            ? "Final reps, converted from the settled on-chain half-rep units."
            : "Logged workout progress. Experimental until settled; live counts do not establish payout eligibility."}
        </p>
      </section>

      <blockquote className="motivation">“Someone’s showing up because you are.”</blockquote>
      <div id="workout" className="mt-10 flex flex-col gap-6">
        {state.settled ? <p>This challenge has ended. Open results to review your claim.</p> : myMember ? (
          <MediaPipeSquatSession challengePubkey={id} teamMemberPubkey={myMember.pubkey} />
        ) : (
          <p className="text-sm text-muted">Connect the wallet you joined with to log a workout.</p>
        )}
        <div>
          <Link
            href={`/challenges/${id}/results`}
            className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/[.04]"
          >
            View results / claim
          </Link>
        </div>
      </div>
    </div>
  );
}

// Same visual idea as the marketing site's club-board avatars: initials in a
// rotated circle, colored distinctly per team.
function TeamAvatar({ name, teamIndex }: { name: string; teamIndex: 0 | 1 }) {
  const bg = teamIndex === 0 ? "#f0d57b" : "#df633b";
  const ink = teamIndex === 0 ? "#3b4226" : "#fff6df";
  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="flex h-9 w-9 shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-white/10 font-serif text-xs font-semibold"
      style={{ background: bg, color: ink }}
    >
      {initials}
    </span>
  );
}
