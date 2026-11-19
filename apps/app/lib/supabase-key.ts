// The server must use a key that bypasses RLS. An anon/publishable key in its
// place fails only on RLS-protected tables, with a confusing RLS error (seen
// in production on 2026-11-19), so refuse it up front. Never echo the key.
export function assertServiceKey(key: string): void {
  if (key.startsWith("sb_secret_")) return;
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (payload?.role === "service_role") return;
    } catch {
      // fall through to the error below
    }
  }
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY must be the project's service_role (or sb_secret_) key, not the anon/publishable key",
  );
}
