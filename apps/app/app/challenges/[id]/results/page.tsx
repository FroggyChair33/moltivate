import { mockChallenge, teamTotal } from "@/lib/mock-data";
import { ClaimButton } from "@/app/components/claim-button";

// Same reasoning as app/challenges/[id]/page.tsx -- reads `params`, will
// fetch per-challenge data later, can't produce a static shell.
export const instant = false;

// Results/claim stub. Settlement (programs/commitment-stakes/) hasn't run
// for any real challenge yet, so the "winner" and per-member numbers here
// are derived from the mocked reps, not an oracle-signed settle() call or a
// settlements/member_payouts row.
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const challenge = mockChallenge;
  const [teamA, teamB] = challenge.teams;
  const totalA = teamTotal(teamA);
  const totalB = teamTotal(teamB);
  const winner = totalA === totalB ? null : totalA > totalB ? teamA : teamB;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        Challenge {id}
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        {challenge.title} -- results
      </h1>

      <p className="mb-8 rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.06]">
        {winner
          ? `${winner.name} wins (${teamTotal(winner)} vs ${
              winner === teamA ? totalB : totalA
            } reps). This is demo data -- no on-chain settle() has run.`
          : "It's a tie in this demo. Real settlement/tie rules are not implemented."}
      </p>

      <div className="flex flex-col gap-6">
        {challenge.teams.map((team) => (
          <div key={team.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {team.name}
            </h2>
            <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
              {team.members.map((member) => {
                const madeGoal = member.reps >= member.goalReps;
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{member.name}</p>
                      <p className="text-xs text-zinc-500">
                        {member.reps}/{member.goalReps} reps &middot;{" "}
                        {madeGoal ? "goal met" : "short of goal"}
                      </p>
                    </div>
                    <ClaimButton memberId={member.id} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
