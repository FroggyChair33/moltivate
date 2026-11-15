import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// Per-member accepted rep totals for one challenge, read-only. Lets the
// scoreboard show *something* before settle() runs -- on-chain
// counted_units is zero until then (see lib.rs TeamMember: "Zero until
// settled"). This is a live, unverified preview, never authoritative;
// settle() is still the only source of truth for what actually gets paid.
export async function GET(request: Request) {
  const challengePubkey = new URL(request.url).searchParams.get("challengePubkey");
  if (!challengePubkey) {
    return NextResponse.json({ error: "challengePubkey query param required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("workout_sessions")
      .select("team_member_pubkey, reps")
      .eq("challenge_pubkey", challengePubkey)
      .eq("status", "accepted");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const totals: Record<string, number> = {};
    for (const row of data ?? []) {
      totals[row.team_member_pubkey] = (totals[row.team_member_pubkey] ?? 0) + row.reps;
    }
    return NextResponse.json({ totals });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
