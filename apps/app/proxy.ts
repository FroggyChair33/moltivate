// Session gate. Runs before pages AND /api/* so an expired access token is refreshed here, where the rotated cookies
// can be written: onto the forwarded request (route handlers' createAuthClient reads the Cookie header and cannot
// write cookies) and onto the response (the browser). The sign-in check is optimistic (cookie JWT via getClaims);
// route handlers still verify with requireAccount. /api/* is never redirected: those routes answer 401 JSON themselves.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNextPath } from "./lib/safe-next-path";

const PUBLIC_PAGES = new Set(["/login", "/signup", "/forgot-password", "/reset-password"]);

function isPublic(pathname: string): boolean {
  return PUBLIC_PAGES.has(pathname) || pathname.startsWith("/auth/") || pathname.startsWith("/join/");
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let cacheHeaders: Record<string, string> = {};
  let signedIn = false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Missing env (CI build, unconfigured dev): treat as signed out rather than crash.
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          cacheHeaders = headers;
          Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    });
    try {
      const { data } = await supabase.auth.getClaims();
      signedIn = Boolean(data?.claims?.sub);
    } catch {
      signedIn = false;
    }
  }

  const { pathname, search } = request.nextUrl;
  if (signedIn || pathname === "/api" || pathname.startsWith("/api/") || isPublic(pathname)) return response;

  const login = new URL("/login", request.url);
  login.searchParams.set("next", safeNextPath(pathname + search));
  const redirect = NextResponse.redirect(login);
  // Keep any cookie change from the refresh attempt (e.g. a cleared, invalid session).
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  Object.entries(cacheHeaders).forEach(([k, v]) => redirect.headers.set(k, v));
  return redirect;
}

export const config = {
  // Everything except build assets, metadata icons, the manifest and any path with a file extension (public/ files).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$|icon$|apple-icon$|manifest\\.webmanifest$|.*\\.[a-zA-Z0-9]+$).*)"],
};
