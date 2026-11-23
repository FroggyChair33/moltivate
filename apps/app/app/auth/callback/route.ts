import { connection, NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNextPath } from "@/lib/safe-next-path";
import { assertPublishableKey } from "@/lib/supabase-key";

// Landing point for emailed links (sign-up confirmation, password reset): trades the one-time code for a session
// cookie, then continues to a same-site path. The code verifier lives in a cookie set by the browser that asked for
// the email, so a link opened in a different browser fails and goes back to /login.
export async function GET(request: NextRequest) {
  await connection(); // per-request: never prerender
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const failed = () => NextResponse.redirect(new URL("/login?error=link", request.url));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!code || !url || !key) return failed();
  assertPublishableKey(key);

  const response = NextResponse.redirect(new URL(safeNextPath(params.get("next")), request.url));
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? failed() : response;
}
