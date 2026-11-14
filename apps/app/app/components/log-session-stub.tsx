"use client";

import { useState } from "react";

// Visible entry point for the workout-session submission surface. Hits the
// stubbed POST /api/workout-sessions route (501) -- there is no Chert call or
// in-browser MediaPipe capture wired up yet, see that route's comments.
export function LogSessionStub({ teamMemberId }: { teamMemberId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function logDemoSession(source: "chert_facetime" | "browser_mediapipe") {
    setStatus("Submitting...");
    const res = await fetch("/api/workout-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamMemberId,
        source,
        reps: 10,
        idempotencyKey: `demo-${Date.now()}`,
      }),
    });
    const data = await res.json();
    setStatus(data.message ?? `HTTP ${res.status}`);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-black/15 p-4 text-sm dark:border-white/20">
      <p className="font-medium">Log a workout (stub)</p>
      <p className="text-zinc-500">
        No camera or FaceTime capture is wired up yet -- these buttons just
        hit the stubbed API route.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => logDemoSession("browser_mediapipe")}
          className="rounded-full border border-black/10 px-4 py-1.5 dark:border-white/15"
        >
          Simulate browser fallback
        </button>
        <button
          type="button"
          onClick={() => logDemoSession("chert_facetime")}
          className="rounded-full border border-black/10 px-4 py-1.5 dark:border-white/15"
        >
          Simulate Chert call
        </button>
      </div>
      {status && <p className="text-xs text-zinc-500">{status}</p>}
    </div>
  );
}
