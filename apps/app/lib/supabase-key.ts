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

// The auth client ships in the browser, so it must use the public key.
// Refuse a service-role/secret key up front. Never echo the key.
export function assertPublishableKey(key: string): void {
  if (key.startsWith("sb_publishable_")) return;
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (payload?.role === "anon") return;
    } catch {
      // fall through to the error below
    }
  }
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the project's publishable (or anon) key, never the service_role/secret key",
  );
}

// Build-time guard used by next.config.ts: NEXT_PUBLIC_* values are inlined into the browser bundle, so a build with
// a secret key here must fail. Unset or empty passes (CI builds without Supabase env vars).
export function assertBuildPublishableKey(key: string | undefined): void {
  if (key) assertPublishableKey(key);
}
