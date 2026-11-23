import { connection } from "next/server";
import { normalizeDisplayName } from "@/lib/display-name";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// Public check used while typing a name. Display names are public anyway; the database is still the real gate.
export async function GET(request: Request) {
  await connection();
  const parsed = normalizeDisplayName(new URL(request.url).searchParams.get("name") ?? "");
  if (!parsed.ok) return Response.json({ available: false, error: parsed.error });

  const { data, error } = await getSupabaseServerClient().from("profiles").select("user_id").eq("display_name_key", parsed.key).maybeSingle();
  if (error) return Response.json({ error: "could not check the name" }, { status: 500 });
  return Response.json({ available: !data });
}
