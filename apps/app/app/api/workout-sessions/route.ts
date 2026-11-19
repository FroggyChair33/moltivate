import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// Records a workout session counted by the in-browser MediaPipe squat counter,
// the app's only capture path. There is no server-side verifier, so every row
// is stored as trust_level 'unverified' and nothing a caller sends can raise it.
// Settlement (app/api/oracle/settle/route.ts) still counts these rows 1:1 --
// a known, documented gap: a determined user can fake browser-reported reps.
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
    body.source !== "browser_mediapipe"
  ) {
    return NextResponse.json({ error: "invalid session payload" }, { status: 400 });
  }

  try {
    new PublicKey(body.challengePubkey);
    new PublicKey(body.teamMemberPubkey);
  } catch {
    return NextResponse.json({ error: "challengePubkey/teamMemberPubkey must be valid pubkeys" }, { status: 400 });
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
        trust_level: "unverified",
        liveness_result: "not_run",
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

    return NextResponse.json({ status: "recorded", id: data.id, trustLevel: "unverified" }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

