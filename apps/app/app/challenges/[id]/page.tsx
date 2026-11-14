import Link from "next/link";
import { mockChallenge, teamTotal, type MockMember } from "@/lib/mock-data";
import { LogSessionStub } from "@/app/components/log-session-stub";

// This route reads `params` and will eventually fetch per-challenge data,
// so it can't produce a static shell under Cache Components; allow it to
// block instead of prerendering.
export const instant = false;

// Live scoreboard stub. Always renders the mocked challenge regardless of
// `id` -- wire this up to a real GET /api/challenges/[id] once that route
// and the Supabase tables exist.
export default async function ChallengeScoreboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const challenge = mockChallenge;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        Challenge {id}
      </p>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        {challenge.title}
      </h1>
      <p className="mb-8 text-sm text-zinc-600 dark:text-zinc-400">
        Goal: {challenge.goalReps} {challenge.exercise} per member &middot;
        ends {new Date(challenge.endsAt).toLocaleDateString()}
      </p>

      <div className="grid gap-8 sm:grid-cols-2">
        {challenge.teams.map((team) => (
          <div key={team.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">{team.name}</h2>
              <span className="text-sm text-zinc-500">
                {teamTotal(team)} total
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {team.members.map((member) => (
                <MemberProgress key={member.id} member={member} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col gap-6">
        <LogSessionStub teamMemberId={challenge.teams[0].members[0].id} />
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

function MemberProgress({ member }: { member: MockMember }) {
  const pct = Math.min(100, Math.round((member.reps / member.goalReps) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>{member.name}</span>
        <span className="text-zinc-500">
          {member.reps}/{member.goalReps}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
