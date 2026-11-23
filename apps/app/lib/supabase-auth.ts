// Per-request Supabase auth client (publishable key) that reads the session from the request's Cookie header.
// Cookies are never written here: proxy.ts refreshes sessions. Create one per request, never at import time.
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { assertPublishableKey } from "./supabase-key";

export function createAuthClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");
  }
  assertPublishableKey(key);
  return createServerClient(url, key, {
    cookies: {
      getAll: async () =>
        parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => ({ name, value: value ?? "" })),
      // Known limit: this discards rotated tokens. If the access token is expired, getUser() refreshes server-side and
      // the new tokens are thrown away, so the browser keeps the old refresh token; once Supabase's refresh-token
      // reuse detection fires, the user is logged out at random. Mitigation: proxy.ts (Task 8) refreshes the session
      // before route handlers run and forwards the refreshed cookies onto the request.
      setAll: () => {},
    },
  });
}
