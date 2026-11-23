import { requireAccount } from "@/lib/account-auth";
import { normalizeDisplayName } from "@/lib/display-name";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// Sets or renames the signed-in account's display name. Uniqueness is enforced by the database (display_name_key).
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.displayName !== "string") {
    return Response.json({ error: "displayName required" }, { status: 400 });
  }
  const parsed = normalizeDisplayName(body.displayName);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { error } = await getSupabaseServerClient()
    .from("profiles")
    .upsert({ user_id: auth.account.userId, display_name: parsed.name, display_name_key: parsed.key }, { onConflict: "user_id" });
  if (error?.code === "23505") return Response.json({ error: "that display name is taken" }, { status: 409 });
  if (error) return Response.json({ error: "could not save the display name" }, { status: 500 });
  return Response.json({ displayName: parsed.name });
}
