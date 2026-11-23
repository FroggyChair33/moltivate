// Gate for cookie-authenticated API routes. Order matters: CSRF checks run before any session lookup.
import { createAuthClient } from "./supabase-auth";
import { isSameOrigin } from "./same-origin";

export type Account = { userId: string; email: string };
type Result = { ok: true; account: Account } | { ok: false; response: Response };

const fail = (status: number, error: string): Result => ({ ok: false, response: Response.json({ error }, { status }) });

export async function requireAccount(request: Request): Promise<Result> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Note: behind a proxy request.url's origin may differ from the public host; verify on the real deployment.
    if (!isSameOrigin(request.headers.get("origin"), request.url)) return fail(403, "cross-origin request refused");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return fail(415, "content-type must be application/json");
    }
  }
  const supabase = createAuthClient(request);
  // getUser() asks the Auth server to verify the token; a decoded JWT alone is not trusted.
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) return fail(401, "not signed in");
  if (!user.email_confirmed_at) return fail(403, "verify your email first");
  // Both MFA inputs must be server-verified, never read from the editable session cookie: the factors come from
  // getUser(), and the current level from the access token's aal claim via getAuthenticatorAssuranceLevel(jwt),
  // which re-verifies that token with the Auth server. Any failure here denies (fail closed).
  if (user.factors?.some((factor) => factor.status === "verified")) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return fail(401, "not signed in");
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (aalError || !aal) return fail(401, "could not verify two-step status");
    if (aal.currentLevel !== "aal2") return fail(401, "two-step verification required");
  }
  return { ok: true, account: { userId: user.id, email: user.email ?? "" } };
}
