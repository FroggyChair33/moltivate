import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getReadOnlyProgram } from "@/lib/server-program";
import { fetchChallengeMembers } from "@/lib/anchor";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { closeChallengeMessage } from "@/lib/close-challenge-message";
import nacl from "tweetnacl";

// Batch "is this challenge closed" lookup, e.g.
// GET /api/challenges/close?challenges=id1,id2.
export async function GET(request: Request) {
  const challenges = new URL(request.url).searchParams.get("challenges");
  if (!challenges) {
    return NextResponse.json({ error: "challenges query param required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("closed_challenges")
      .select("challenge_pubkey")
      .in("challenge_pubkey", challenges.split(",").filter(Boolean));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ closed: (data ?? []).map((row) => row.challenge_pubkey) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Marks a challenge as closed -- a UI-only dismissal (see the migration's
// comment), never an on-chain action. This never touches claim() or any
// account's lamports; the gating here exists purely so a challenge can't
// disappear from people's "current challenges" view while someone still
// has an unclaimed payout sitting in it, which would make it easy to
// forget about money that's still legitimately claimable.
//
// Authorization: the caller signs closeChallengeMessage(wallet, challenge)
// (same pattern as app/api/users), and that wallet must be the creator or a
// joined member on chain. The signature has no expiry or nonce on purpose:
// it binds this wallet and this challenge, and closing is idempotent, so a
// replayed signature can only repeat a close that already happened.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.challengePubkey !== "string" ||
    typeof body.wallet !== "string" ||
    typeof body.signature !== "string"
  ) {
    return NextResponse.json({ error: "challengePubkey, wallet and signature required" }, { status: 400 });
  }

  let challengePk: PublicKey;
  let walletPk: PublicKey;
  try {
    challengePk = new PublicKey(body.challengePubkey);
    walletPk = new PublicKey(body.wallet);
  } catch {
    return NextResponse.json({ error: "challengePubkey and wallet must be valid pubkeys" }, { status: 400 });
  }

  const message = new TextEncoder().encode(closeChallengeMessage(body.wallet, body.challengePubkey));
  try {
    // verify throws on a malformed signature (wrong length), hence the try.
    const verified = nacl.sign.detached.verify(message, Buffer.from(body.signature, "base64"), walletPk.toBytes());
    if (!verified) {
      return NextResponse.json({ error: "signature does not match wallet and challenge" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "malformed signature" }, { status: 400 });
  }

  try {
    const program = getReadOnlyProgram();
    const [challengeAcc, members] = await Promise.all([
      program.account.challenge.fetch(challengePk),
      fetchChallengeMembers(program, challengePk),
    ]);

    if (!challengeAcc.settled) {
      return NextResponse.json({ error: "challenge is not settled yet" }, { status: 400 });
    }
    if (members.length === 0) {
      return NextResponse.json({ error: "challenge has no members" }, { status: 400 });
    }
    if (!members.every((m) => m.account.claimed)) {
      return NextResponse.json({ error: "every member must claim their payout before this can be closed" }, { status: 400 });
    }

    const isCreator = challengeAcc.creator.toBase58() === body.wallet;
    const isMember = members.some((m) => m.account.owner.toBase58() === body.wallet);
    if (!isCreator && !isMember) {
      return NextResponse.json({ error: "wallet is not the creator or a member of this challenge" }, { status: 403 });
    }

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("closed_challenges")
      .upsert({ challenge_pubkey: body.challengePubkey, closed_by: body.wallet }, { onConflict: "challenge_pubkey" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ status: "closed" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
