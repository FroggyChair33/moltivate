"use client";

import { useEffect, useRef, useState } from "react";

// Real reservation on the Vultr live-coach worker (lib/live-coach-client.ts
// -> app/api/live-coach/session), shown here for the first time. Calling
// the real Chert number only connects to this specific session if the
// VM-side caller-pairing/webhook work is also done (separate, not
// something this app controls) -- /readyz on the worker reports
// `caller_pairing_pending` until that exists. This UI is honest either
// way: it shows the real reservation state, never a fake "connected".
const CHERT_NUMBER = "+1 (206) 465-5399";

type SessionState = {
  session_id: string;
  state: string;
  expires_at: number;
  payout_eligible: false;
  transport_ready: boolean;
};

export function LiveCoachCall({
  challengePubkey,
  teamMemberPubkey,
}: {
  challengePubkey: string;
  teamMemberPubkey: string;
}) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(sessionId: string) {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/live-coach/session/${sessionId}`);
        const data = await res.json();
        if (res.ok) setSession(data);
      } catch {
        // Transient poll failure -- keep showing the last known state.
      }
    }, 4000);
  }

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/live-coach/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengePubkey, teamMemberPubkey }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 503) throw new Error("Live coach isn't connected yet -- try the camera session below instead.");
        if (res.status === 409) throw new Error("Someone else has an active live-coach session right now. Try again in a few minutes.");
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSession(data);
      startPolling(data.session_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function handleEnd() {
    if (!session) return;
    setEnding(true);
    try {
      const res = await fetch(`/api/live-coach/session/${session.session_id}/end`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setSession(data);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/15 p-4 text-sm">
      <p className="font-medium">Live coach call (experimental)</p>
      <p className="text-xs text-muted">
        Reserves a real slot on our live coaching worker. FaceTime {CHERT_NUMBER} once reserved.
        Counts here are never payout-eligible -- log your real workout with the camera session
        below either way.
      </p>

      {!session || session.state === "ended" ? (
        <button
          type="button"
          disabled={starting}
          onClick={handleStart}
          className="w-fit rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background disabled:opacity-50"
        >
          {starting ? "Reserving..." : "Start live coach call"}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs">
            Reserved -- state: <strong>{session.state}</strong>.
          </p>
          <a
            href={`facetime:${CHERT_NUMBER.replace(/[^\d+]/g, "")}`}
            className="w-fit rounded-lg bg-foreground px-4 py-3 text-lg font-semibold text-background underline-offset-4 hover:underline"
          >
            Call now: {CHERT_NUMBER}
          </a>
          <button
            type="button"
            disabled={ending}
            onClick={handleEnd}
            className="w-fit rounded-full border border-black/10 px-4 py-2 text-xs font-medium disabled:opacity-50"
          >
            {ending ? "Ending..." : "End call"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
