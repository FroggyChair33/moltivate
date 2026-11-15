"use client";

import { useState } from "react";

// Placeholder for the Chert FaceTime primary capture path, which is not
// built yet (separate hackathon-sponsor VM, teammate's work -- see
// HANDOFF.md). Records a real row via POST /api/workout-sessions, but every
// session this creates is honestly `unverified` since there's no real call
// behind it (see that route's comments). The browser fallback path has a
// real implementation now: MediaPipeSquatSession.
export function LogSessionStub({
  challengePubkey,
  teamMemberPubkey,
}: {
  challengePubkey: string;
  teamMemberPubkey: string;
}) {
  const [status, setStatus] = useState<string | null>(null);

  async function logDemoSession() {
    setStatus("Submitting...");
    const res = await fetch("/api/workout-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengePubkey,
        teamMemberPubkey,
        source: "chert_facetime",
        reps: 10,
        idempotencyKey: `demo-${Date.now()}`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setStatus(data.status ? `${data.status} (reps: 10, unverified)` : `HTTP ${res.status}`);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-black/15 p-4 text-sm dark:border-white/20">
      <p className="font-medium">Log a workout (Chert call placeholder, unverified)</p>
      <p className="text-zinc-500">
        No FaceTime capture is wired up yet -- this records a real but
        unverified 10-rep claim for this member, standing in for that path.
      </p>
      <button
        type="button"
        onClick={logDemoSession}
        className="w-fit rounded-full border border-black/10 px-4 py-1.5 dark:border-white/15"
      >
        Simulate Chert call
      </button>
      {status && <p className="text-xs text-zinc-500">{status}</p>}
    </div>
  );
}
