import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { fetchChallengeMembers, teamPda } from "@/lib/anchor";
import { getOracleKeypair, getOracleProgram } from "@/lib/oracle";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { memberCount } from "@/lib/settle-counts";

// Settles one challenge (body: { challenge: "<pubkey>" }), or every eligible
// challenge on chain if no body is given (for a cron trigger). "Eligible"
// means: not already settled, and its deadline has passed -- the program
// itself also enforces both, so this is just avoiding a doomed-to-fail
// transaction, not the actual authority on either check.
//
// Workout counts come from summing every `accepted` workout_sessions row for
// each member, with no trust_level filter. That's a real, known gap: this
// version has no server-side verifier, so every session is `unverified`
// browser-reported reps (see app/api/workout-sessions/route.ts) and they are
// counted 1:1. Filtering by trust level only makes sense once a reviewed
// verifier exists; until then it would make every challenge unsettleable.
export async function POST(request: Request) {
  // Wrapping the whole handler: any of getOracleProgram()/program.account
  // calls/PublicKey parsing can throw before ever reaching settleOne's own
  // try/catch, and an uncaught throw here means Next.js's default 500 with
  // no JSON body at all - worse for a caller (the "Settle now" button, or a
  // future cron trigger) to handle than a clean error response.
  try {
    const body = await request.json().catch(() => ({}));
    const program = getOracleProgram();

    let targets: PublicKey[];
    if (typeof body.challenge === "string") {
      targets = [new PublicKey(body.challenge)];
    } else {
      const all = await program.account.challenge.all();
      const nowUnix = Math.floor(Date.now() / 1000);
      targets = all
        .filter((c) => !c.account.settled && c.account.deadlineUnix.toNumber() <= nowUnix)
        .map((c) => c.publicKey);
    }

    const results = [];
    for (const challengePk of targets) {
      results.push(await settleOne(program, challengePk));
    }
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

async function settleOne(program: ReturnType<typeof getOracleProgram>, challengePk: PublicKey) {
  const base58 = challengePk.toBase58();
  try {
    const challengeAcc = await program.account.challenge.fetch(challengePk);
    if (challengeAcc.settled) {
      return { challenge: base58, status: "already_settled" };
    }

    const members = await fetchChallengeMembers(program, challengePk);
    if (members.length === 0) {
      return { challenge: base58, status: "no_members" };
    }

    const supabase = getSupabaseServerClient();
    const counts: number[] = [];
    for (const m of members) {
      const { data, error } = await supabase
        .from("workout_sessions")
        .select("reps")
        .eq("team_member_pubkey", m.publicKey.toBase58())
        .eq("status", "accepted");
      if (error) {
        return { challenge: base58, status: "error", message: `reading sessions for ${m.publicKey.toBase58()}: ${error.message}` };
      }
      counts.push(memberCount(data ?? []));
    }

    const oracle = getOracleKeypair();
    // .accountsPartial(), not .accounts(): same Anchor generated-type
    // quirk as claim-button.tsx (an account with `relations` mixed with
    // `pda` accounts on the same instruction) - see that file's comment.
    const signature = await program.methods
      .settle(counts)
      .accountsPartial({
        oracle: oracle.publicKey,
        challenge: challengePk,
        teamA: teamPda(challengePk, 0),
        teamB: teamPda(challengePk, 1),
        pot: challengeAcc.group,
      })
      .signers([oracle])
      .remainingAccounts(members.map((m) => ({ pubkey: m.publicKey, isWritable: true, isSigner: false })))
      .rpc();
    return { challenge: base58, status: "settled", signature, counts };
  } catch (err) {
    return { challenge: base58, status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
