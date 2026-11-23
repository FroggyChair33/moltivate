import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getReadOnlyProgram } from "@/lib/server-program";
import { requireAccount } from "@/lib/account-auth";
import { getLinkedWallets } from "@/lib/linked-wallets";

// Records a workout session counted by the in-browser MediaPipe squat counter,
// the app's only capture path. There is no server-side verifier, so every row
// is stored as trust_level 'unverified' and nothing a caller sends can raise it.
// Settlement (app/api/oracle/settle/route.ts) still counts these rows 1:1 --
// a known, documented gap: a determined user can fake browser-reported reps.
//
// The caller must be signed in (requireAccount), and a wallet linked to that
// account must own the member account on chain (checked fresh on every
// request, so unlinking takes effect immediately). That proves who submits,
// not that the reps are real. The member must also belong to the challenge,
// and the challenge must still be open.
// Far above any real single session; stops one row from swamping the totals.
const MAX_REPS_PER_SESSION = 10_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (!auth.ok) return auth.response;
  const { account } = auth;

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
    body.source !== "browser_mediapipe"
  ) {
    return NextResponse.json({ error: "invalid session payload" }, { status: 400 });
  }

  let challengePk: PublicKey;
  let memberPk: PublicKey;
  try {
    challengePk = new PublicKey(body.challengePubkey);
    memberPk = new PublicKey(body.teamMemberPubkey);
  } catch {
    return NextResponse.json({ error: "challengePubkey and teamMemberPubkey must be valid pubkeys" }, { status: 400 });
  }

  const nowSeconds = Date.now() / 1000;

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
  // Never cached: an unlink must stop the very next submission. Fails closed.
  let linked: string[];
  try {
    linked = await getLinkedWallets(account.userId);
  } catch {
    return NextResponse.json({ error: "could not verify your linked wallets; retry" }, { status: 503 });
  }
  if (!linked.includes(memberAcc.owner.toBase58())) {
    return NextResponse.json({ error: "this wallet isn't linked to your account" }, { status: 403 });
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
        account_id: account.userId,
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
