import { NextResponse } from "next/server";

// Stub session-submission surface. Real capture paths (Chert FaceTime call
// -> server-side MediaPipe, or the in-browser MediaPipe fallback) are out of
// scope here -- see AGENTS.md "Technical direction". This route exists so
// the client has a stable endpoint to call, and so the request/response
// shape matches the workout_sessions table (supabase/migrations) once a real
// handler lands.
//
// Not implemented: auth, persistence, idempotency-key dedup, CV verification.
// Treat `reps`, `source`, and every other field here as untrusted input per
// AGENTS.md "Verification, authentication, and data" -- do not trust them
// once a real verifier exists.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.teamMemberId !== "string" ||
    typeof body.idempotencyKey !== "string" ||
    (body.source !== "chert_facetime" && body.source !== "browser_mediapipe")
  ) {
    return NextResponse.json({ error: "invalid session payload" }, { status: 400 });
  }

  return NextResponse.json(
    {
      status: "stubbed",
      message:
        "No verifier or database is wired up yet. This session was not recorded.",
      received: {
        teamMemberId: body.teamMemberId,
        source: body.source,
        idempotencyKey: body.idempotencyKey,
      },
    },
    { status: 501 },
  );
}
