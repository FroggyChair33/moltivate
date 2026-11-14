"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// Create-challenge form stub. Submitting does not hit an API yet -- there is
// no challenges API route or Anchor program wired up. It only navigates to
// the mocked scoreboard so the lifecycle can be clicked through end to end.
export default function NewChallengePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [stakeSol, setStakeSol] = useState("0.25");
  const [goalReps, setGoalReps] = useState("150");
  const [alphaPercent, setAlphaPercent] = useState("20");
  const [durationDays, setDurationDays] = useState("7");
  const [teamAName, setTeamAName] = useState("Sunrise Squad");
  const [teamBName, setTeamBName] = useState("Night Owls");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // TODO(backend): POST to /api/challenges once it exists; that route
    // creates the draft row (status 'draft') and, once funded on-chain,
    // flips it to 'open'. For now, just land on the mocked scoreboard.
    router.push("/challenges/demo");
  }

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Create a challenge
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Title">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Push-up Pact"
            className="input"
          />
        </Field>

        <Field label="Stake per person (devnet SOL)">
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={stakeSol}
            onChange={(e) => setStakeSol(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Weekly goal (reps)">
          <input
            required
            type="number"
            min="1"
            value={goalReps}
            onChange={(e) => setGoalReps(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Alpha (% of stake always at risk)">
          <input
            required
            type="number"
            min="0"
            max="100"
            value={alphaPercent}
            onChange={(e) => setAlphaPercent(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Duration (days)">
          <input
            required
            type="number"
            min="1"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Team A name">
            <input
              required
              value={teamAName}
              onChange={(e) => setTeamAName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Team B name">
            <input
              required
              value={teamBName}
              onChange={(e) => setTeamBName(e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <button
          type="submit"
          className="mt-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Create (demo)
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
