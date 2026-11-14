// Hardcoded fixture data for page scaffolding only. Nothing here is read
// from Supabase or the chain yet -- see AGENTS.md "Working on the functional
// app (apps/app)". Replace with real queries once the API routes exist.

export type MockMember = {
  id: string;
  name: string;
  walletShort: string;
  reps: number;
  goalReps: number;
};

export type MockTeam = {
  id: string;
  name: string;
  members: MockMember[];
};

export type MockChallenge = {
  id: string;
  title: string;
  exercise: string;
  stakeSol: number;
  goalReps: number;
  alphaBps: number;
  rakeBps: number;
  endsAt: string;
  teams: [MockTeam, MockTeam];
};

export const mockChallenge: MockChallenge = {
  id: "demo",
  title: "Push-up Pact",
  exercise: "push-ups",
  stakeSol: 0.25,
  goalReps: 150,
  alphaBps: 2000,
  rakeBps: 300,
  endsAt: "2026-11-21T00:00:00Z",
  teams: [
    {
      id: "team-sunrise",
      name: "Sunrise Squad",
      members: [
        { id: "m1", name: "Avery", walletShort: "7xKX...9f2q", reps: 160, goalReps: 150 },
        { id: "m2", name: "Jordan", walletShort: "3pQw...k81z", reps: 90, goalReps: 150 },
        { id: "m3", name: "Sam", walletShort: "Bz4t...mN2x", reps: 150, goalReps: 150 },
      ],
    },
    {
      id: "team-nightowls",
      name: "Night Owls",
      members: [
        { id: "m4", name: "Riley", walletShort: "9aLp...q7Rw", reps: 40, goalReps: 150 },
        { id: "m5", name: "Casey", walletShort: "Hd2v...e3Yt", reps: 110, goalReps: 150 },
        { id: "m6", name: "Morgan", walletShort: "Ux8n...c5Jp", reps: 70, goalReps: 150 },
      ],
    },
  ],
};

export function teamTotal(team: MockTeam): number {
  return team.members.reduce((sum, m) => sum + Math.min(m.reps, m.goalReps * 1.5), 0);
}
