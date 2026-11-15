import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// Records a claimed workout session.
//
// Two callers, two trust levels:
// - The app's own demo UI (log-session-stub.tsx) calls this with no auth.
//   Every such session is forced to `unverified` regardless of what it
//   claims - there is no real CV/Chert verifier wired up client-side.
// - The future Chert/MediaPipe verification service (planned to run on a
//   separate VM - see AGENTS.md) calls this authenticated with a shared
//   secret (`Authorization: Bearer <WORKOUT_INGEST_SECRET>`), and may assert
//   a real `trustLevel`/`livenessResult` since actual verification happened
//   upstream of this call. Nothing else distinguishes the two - same
//   endpoint, same body shape, auth header is the only difference.
//
// The oracle (app/api/oracle/settle/route.ts) currently counts every
// `accepted` session regardless of trust_level - that's a deliberate,
// documented gap for demoing before the verifier exists, not an oversight.
// Once the VM is actually sending verified sessions, reconsider whether the
// oracle should still count plain `unverified` ones at all.
const TRUSTED_LEVELS = new Set(["verified", "low_trust"]);
const LIVENESS_RESULTS = new Set(["not_run", "pass", "fail"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.challengePubkey !== "string" ||
    typeof body.teamMemberPubkey !== "string" ||
    typeof body.idempotencyKey !== "string" ||
    typeof body.reps !== "number" ||
    !Number.isInteger(body.reps) ||
    body.reps < 0 ||
    (body.source !== "chert_facetime" && body.source !== "browser_mediapipe")
  ) {
    return NextResponse.json({ error: "invalid session payload" }, { status: 400 });
  }

  try {
    new PublicKey(body.challengePubkey);
    new PublicKey(body.teamMemberPubkey);
  } catch {
    return NextResponse.json({ error: "challengePubkey/teamMemberPubkey must be valid pubkeys" }, { status: 400 });
  }

  const trusted = isTrustedCaller(request);
  let trustLevel = "unverified";
  let livenessResult = "not_run";
  if (trusted) {
    if (typeof body.trustLevel === "string" && TRUSTED_LEVELS.has(body.trustLevel)) {
      trustLevel = body.trustLevel;
    }
    if (typeof body.livenessResult === "string" && LIVENESS_RESULTS.has(body.livenessResult)) {
      livenessResult = body.livenessResult;
    }
  }

  // Everything below can throw before ever reaching a `{ error }` (missing
  // Supabase env vars, a network blip) - without this, that's an uncaught
  // exception and Next.js's default 500 has no JSON body at all, which is
  // worse for a caller to handle than a clean error response.
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("workout_sessions")
      .insert({
        challenge_pubkey: body.challengePubkey,
        team_member_pubkey: body.teamMemberPubkey,
        source: body.source,
        reps: body.reps,
        trust_level: trustLevel,
        liveness_result: livenessResult,
        status: "accepted",
        idempotency_key: body.idempotencyKey,
      })
      .select("id")
      .single();

    if (error) {
      // Unique violation on (team_member_pubkey, idempotency_key) means this
      // exact session was already recorded -- not an error from the caller's
      // point of view, just "already have it".
      if (error.code === "23505") {
        return NextResponse.json({ status: "duplicate", message: "already recorded" }, { status: 200 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: "recorded", id: data.id, trustLevel }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

function isTrustedCaller(request: Request): boolean {
  const secret = process.env.WORKOUT_INGEST_SECRET;
  if (!secret) return false; // not configured yet - every caller is untrusted
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
