import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getReadOnlyProgram } from "@/lib/server-program";
import { fetchChallengeMembers } from "@/lib/anchor";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { requireAccount } from "@/lib/account-auth";
import { getLinkedWallets } from "@/lib/linked-wallets";

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
// Authorization: the caller must be signed in (requireAccount), and a wallet
// linked to that account must be the creator or a joined member on chain. The
// linked wallets are read fresh on every request, so unlinking takes effect
// immediately, and a failed lookup fails closed. Closing is idempotent.
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (!auth.ok) return auth.response;
  const { account } = auth;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.challengePubkey !== "string") {
    return NextResponse.json({ error: "challengePubkey required" }, { status: 400 });
  }

  let challengePk: PublicKey;
  try {
    challengePk = new PublicKey(body.challengePubkey);
  } catch {
    return NextResponse.json({ error: "challengePubkey must be a valid pubkey" }, { status: 400 });
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

    let linked: string[];
    try {
      linked = await getLinkedWallets(account.userId);
    } catch {
      return NextResponse.json({ error: "could not verify your linked wallets; retry" }, { status: 503 });
    }
    // Creator wallet first, so closed_by names it when both qualify.
    const creator = challengeAcc.creator.toBase58();
    const memberOwners = new Set(members.map((m) => m.account.owner.toBase58()));
    const closer = linked.includes(creator) ? creator : linked.find((w) => memberOwners.has(w));
    if (!closer) {
      return NextResponse.json({ error: "none of your linked wallets is the creator or a member of this challenge" }, { status: 403 });
    }

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("closed_challenges")
      .upsert({ challenge_pubkey: body.challengePubkey, closed_by: closer }, { onConflict: "challenge_pubkey" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ status: "closed" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
