import { getSupabaseServerClient } from "./supabase-server";
import { normalizeDisplayName } from "./display-name";

const UNIQUE_VIOLATION = "23505";

export async function getDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await getSupabaseServerClient().from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`profiles read failed: ${error.message}`);
  return data?.display_name ?? null;
}

// Returns the account's profile, creating it from the sign-up metadata name when there is none yet.
// The metadata is untrusted (Supabase's public sign-up accepts any metadata), so it is normalised like any other
// name. A taken or invalid name is not an error: the caller gets null and asks the person to pick one.
export async function ensureProfile(userId: string, metadataName: unknown): Promise<{ displayName: string | null }> {
  const existing = await getDisplayName(userId);
  if (existing) return { displayName: existing };
  if (typeof metadataName !== "string") return { displayName: null };
  const parsed = normalizeDisplayName(metadataName);
  if (!parsed.ok) return { displayName: null };
  const { error } = await getSupabaseServerClient()
    .from("profiles")
    .insert({ user_id: userId, display_name: parsed.name, display_name_key: parsed.key });
  if (!error) return { displayName: parsed.name };
  if (error.code !== UNIQUE_VIOLATION) throw new Error(`profiles insert failed: ${error.message}`);
  // Name taken by someone else, or a concurrent request created this profile first: re-read to tell which.
  return { displayName: await getDisplayName(userId) };
}
