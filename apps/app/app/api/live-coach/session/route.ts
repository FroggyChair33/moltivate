import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { startLiveCoachSession, LiveCoachNotConfiguredError } from "@/lib/live-coach-client";

// Starts an experimental live-coach session (Chert FaceTime call + the
// Vultr LiveKit agent) for one team member. This is NOT wired into
// settlement in any way -- the VM's own API always returns
// payout_eligible: false, and nothing here writes to workout_sessions or
// counts toward a goal yet (that callback path doesn't exist on either
// side -- see docs/live/APP_HANDOFF.md).
//
// Returns 503 until LIVE_COACH_BASE_URL/LIVE_COACH_KEY_ID/LIVE_COACH_SECRET
// are all set -- expected right now, not a bug, since the worker has no
// public hostname yet.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.challengePubkey !== "string" || typeof body.teamMemberPubkey !== "string") {
    return NextResponse.json({ error: "challengePubkey and teamMemberPubkey required" }, { status: 400 });
  }

  try {
    const sessionId = randomUUID();
    const result = await startLiveCoachSession({
      sessionId,
      idempotencyKey: sessionId,
      // The control API's own identifier regex is [A-Za-z0-9_-]{1,128} --
      // confirmed by testing against the real server, which rejects a `:`
      // separator with a 400. Base58 pubkeys only ever contain
      // alphanumerics, so a hyphen join is always valid.
      membershipRef: `${body.challengePubkey}-${body.teamMemberPubkey}`,
      expiresInSeconds: 300,
    });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    if (err instanceof LiveCoachNotConfiguredError) {
      return NextResponse.json({ error: "live coach is not configured yet" }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
