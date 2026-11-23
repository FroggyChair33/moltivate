import { connection } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const MAX_WALLETS = 100;

// Batch display-name lookup, e.g. GET /api/users?wallets=addr1,addr2.
// Read-only, no auth needed -- display names are public. A wallet resolves to the name of the account it is linked to
// (linked_wallets -> profiles); unlinked wallets are simply absent. Names only: never emails or user ids.
export async function GET(request: Request) {
  await connection();
  const wallets = (new URL(request.url).searchParams.get("wallets") ?? "").split(",").filter(Boolean);
  if (wallets.length === 0) {
    return Response.json({ error: "wallets query param required" }, { status: 400 });
  }
  if (wallets.length > MAX_WALLETS) {
    return Response.json({ error: `at most ${MAX_WALLETS} wallets per request` }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data: links, error: linkError } = await supabase
      .from("linked_wallets")
      .select("wallet_address, user_id")
      .in("wallet_address", wallets);
    if (linkError) return Response.json({ error: "could not look up names" }, { status: 500 });
    if (!links?.length) return Response.json({ names: {} });

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", [...new Set(links.map((row) => row.user_id))]);
    if (profileError) return Response.json({ error: "could not look up names" }, { status: 500 });

    const byUser = new Map((profiles ?? []).map((row) => [row.user_id, row.display_name]));
    const names: Record<string, string> = {};
    for (const link of links) {
      const name = byUser.get(link.user_id);
      if (name) names[link.wallet_address] = name;
    }
    return Response.json({ names });
  } catch {
    return Response.json({ error: "could not look up names" }, { status: 500 });
  }
}
