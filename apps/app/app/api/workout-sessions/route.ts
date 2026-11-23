import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getReadOnlyProgram } from "@/lib/server-program";
import { SESSION_KEY_TTL_SECONDS, sessionAuthMessage, workoutMessage } from "@/lib/workout-auth";
import nacl from "tweetnacl";

// Records a workout session counted by the in-browser MediaPipe squat counter,
// the app's only capture path. There is no server-side verifier, so every row
// is stored as trust_level 'unverified' and nothing a caller sends can raise it.
// Settlement (app/api/oracle/settle/route.ts) still counts these rows 1:1 --
// a known, documented gap: a determined user can fake browser-reported reps.
//
// The caller proves it acts for the member's wallet with a session key (see
// lib/workout-auth.ts): the wallet signed once to authorize the key, and the
// key signed this submission. On chain, the wallet must own the member
// account, the member must belong to the challenge, and the challenge must
// still be open.
// Far above any real single session; stops one row from swamping the totals.
const MAX_REPS_PER_SESSION = 10_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.challengePubkey !== "string" ||
    typeof body.teamMemberPubkey !== "string" ||
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.trim() === "" ||
    body.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    typeof body.reps !== "number" ||
    !Number.isInteger(body.reps) ||
    body.reps < 0 ||
    body.reps > MAX_REPS_PER_SESSION ||
    body.source !== "browser_mediapipe" ||
    typeof body.wallet !== "string" ||
    typeof body.sessionKey !== "string" ||
    typeof body.authSignature !== "string" ||
    typeof body.signature !== "string" ||
    typeof body.expiresAt !== "number" ||
    !Number.isInteger(body.expiresAt)
  ) {
    return NextResponse.json({ error: "invalid session payload" }, { status: 400 });
  }

  let challengePk: PublicKey;
  let memberPk: PublicKey;
  let walletPk: PublicKey;
  let sessionPk: PublicKey;
  try {
    challengePk = new PublicKey(body.challengePubkey);
    memberPk = new PublicKey(body.teamMemberPubkey);
    walletPk = new PublicKey(body.wallet);
    sessionPk = new PublicKey(body.sessionKey);
  } catch {
    return NextResponse.json({ error: "challengePubkey, teamMemberPubkey, wallet and sessionKey must be valid pubkeys" }, { status: 400 });
  }

  const nowSeconds = Date.now() / 1000;
  if (body.expiresAt > nowSeconds + SESSION_KEY_TTL_SECONDS + 60) {
    return NextResponse.json({ error: "session authorization lasts too long" }, { status: 400 });
  }
  if (nowSeconds >= body.expiresAt) {
    return NextResponse.json({ error: "session authorization expired; start a new session" }, { status: 401 });
  }
  const authMessage = sessionAuthMessage({
    wallet: body.wallet,
    sessionKey: body.sessionKey,
    challenge: body.challengePubkey,
    member: body.teamMemberPubkey,
    expiresAt: body.expiresAt,
  });
  const submission = workoutMessage({
    challenge: body.challengePubkey,
    member: body.teamMemberPubkey,
    idempotencyKey: body.idempotencyKey,
    reps: body.reps,
  });
  try {
    // verify throws on a malformed signature (wrong length), hence the try.
    const encode = (text: string) => new TextEncoder().encode(text);
    const authorized = nacl.sign.detached.verify(encode(authMessage), Buffer.from(body.authSignature, "base64"), walletPk.toBytes());
    const signedByKey = nacl.sign.detached.verify(encode(submission), Buffer.from(body.signature, "base64"), sessionPk.toBytes());
    if (!authorized || !signedByKey) {
      return NextResponse.json({ error: "session signature does not match" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "malformed signature" }, { status: 400 });
  }

  // fetchNullable: a missing account is null, an RPC failure throws -- so an
  // outage is reported as retryable instead of as "not a member".
  let challengeAcc, memberAcc;
  try {
    const program = getReadOnlyProgram();
    [challengeAcc, memberAcc] = await Promise.all([
      program.account.challenge.fetchNullable(challengePk),
      program.account.teamMember.fetchNullable(memberPk),
    ]);
  } catch {
    return NextResponse.json({ error: "could not verify challenge membership; retry" }, { status: 503 });
  }
  if (!challengeAcc) {
    return NextResponse.json({ error: "challenge not found" }, { status: 404 });
  }
  if (!memberAcc || !memberAcc.challenge.equals(challengePk)) {
    return NextResponse.json({ error: "not a member of this challenge" }, { status: 403 });
  }
  if (!memberAcc.owner.equals(walletPk)) {
    return NextResponse.json({ error: "this wallet doesn't own that member account" }, { status: 403 });
  }
  const closedReason = challengeAcc.settled
    ? "challenge is already settled"
    : nowSeconds >= challengeAcc.deadlineUnix.toNumber()
      ? "challenge deadline has passed"
      : null;
  if (closedReason) {
    // A retry whose first attempt was saved just before closing (response lost)
    // should hear "already recorded", not that the set was lost.
    if (await alreadyRecorded(body.teamMemberPubkey, body.idempotencyKey)) {
      return NextResponse.json({ status: "duplicate", message: "already recorded" }, { status: 200 });
    }
    return NextResponse.json({ error: closedReason }, { status: 409 });
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


// Lookup failures count as "not recorded": the caller then gets the 409, which
// is what they'd have seen without this check.
async function alreadyRecorded(teamMemberPubkey: string, idempotencyKey: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseServerClient()
      .from("workout_sessions")
      .select("id")
      .eq("team_member_pubkey", teamMemberPubkey)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
