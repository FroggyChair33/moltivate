// Server-only Supabase client using the service-role key. Never import this
// from a Client Component or anything that ships to the browser -- see
// AGENTS.md "Keep backend database credentials ... out of the mobile bundle
// and repository."
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { assertServiceKey } from "./supabase-key";

export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  assertServiceKey(key);
  return createClient(url, key, { auth: { persistSession: false } });
}
