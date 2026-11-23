import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import ts from "typescript";

// proxy.ts runs transpiled with stubbed next/server and @supabase/ssr; safeNextPath is the real helper.
// The matcher is checked with Next's own matcher test helper (it needs AsyncLocalStorage on globalThis).
const require = createRequire(import.meta.url);
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server");

const load = (file, requireFn, env) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: requireFn, process: { env }, URL, Object });
  return exportsObject;
};
const none = (n) => { throw new Error(n); };
const safeNext = load("lib/safe-next-path.ts", none, {});

// ---- fakes ----
const cookieJar = (initial = []) => {
  const map = new Map(initial.map((c) => [c.name, c]));
  return {
    getAll: () => [...map.values()],
    get: (name) => map.get(name),
    set: (nameOrCookie, value, options) => {
      const c = typeof nameOrCookie === "object" ? nameOrCookie : { name: nameOrCookie, value, ...options };
      map.set(c.name, c);
    },
  };
};
const NextResponse = {
  next: (init) => ({ kind: "next", forwarded: init?.request, cookies: cookieJar(), headers: new Headers() }),
  redirect: (url) => ({ kind: "redirect", url: String(url), cookies: cookieJar(), headers: new Headers() }),
};

let getClaims; // per-test behaviour of the fake auth client
let clientsCreated;
const ssr = {
  createServerClient: (url, key, options) => {
    clientsCreated++;
    return { auth: { getClaims: () => getClaims(options.cookies) } };
  },
};

const stubs = (name) => {
  if (name === "next/server") return { NextResponse };
  if (name === "@supabase/ssr") return ssr;
  if (name === "./lib/safe-next-path" || name === "@/lib/safe-next-path") return safeNext;
  throw new Error(name);
};
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://sb.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };
const mod = load("proxy.ts", stubs, env);
const modNoEnv = load("proxy.ts", stubs, {});

const request = (path, cookies = []) => {
  const url = `https://app.test${path}`;
  return { url, nextUrl: new URL(url), cookies: cookieJar(cookies) };
};
const signedIn = async () => ({ data: { claims: { sub: "u1" } }, error: null });
const signedOut = async () => ({ data: null, error: null });

beforeEach(() => {
  getClaims = signedOut;
  clientsCreated = 0;
});

test("signed-out page request redirects to /login with next", async () => {
  const res = await mod.proxy(request("/"));
  assert.equal(res.kind, "redirect");
  assert.equal(res.url, "https://app.test/login?next=%2F");
});

test("signed-out deep link keeps its path and query in next", async () => {
  const res = await mod.proxy(request("/challenges/abc?tab=board"));
  assert.equal(res.url, "https://app.test/login?next=%2Fchallenges%2Fabc%3Ftab%3Dboard");
});

test("an unsafe path is never used as next", async () => {
  const res = await mod.proxy(request("//evil.com"));
  assert.equal(res.kind, "redirect");
  assert.equal(new URL(res.url).origin, "https://app.test");
  assert.equal(new URL(res.url).searchParams.get("next"), "/");
});

for (const path of ["/login", "/login?next=//evil.com", "/signup", "/forgot-password", "/reset-password", "/auth/callback?code=x", "/join/abc"]) {
  test(`public path ${path} passes when signed out`, async () => {
    const res = await mod.proxy(request(path));
    assert.equal(res.kind, "next");
  });
}

test("a path that only starts like a public one is still gated", async () => {
  assert.equal((await mod.proxy(request("/loginx"))).kind, "redirect");
  assert.equal((await mod.proxy(request("/joined"))).kind, "redirect");
});

test("signed-in page request passes", async () => {
  getClaims = signedIn;
  assert.equal((await mod.proxy(request("/challenges/new"))).kind, "next");
});

test("/api/* is never redirected, even signed out", async () => {
  for (const path of ["/api/me", "/api/profile/name-available?name=a", "/api"]) {
    const res = await mod.proxy(request(path));
    assert.equal(res.kind, "next", path);
  }
  assert.equal(clientsCreated, 3); // the session refresh still ran
});

test("refreshed cookies go onto the forwarded request and the response", async () => {
  getClaims = async (cookies) => {
    assert.deepEqual(cookies.getAll(), [{ name: "sb-auth", value: "old" }]);
    await cookies.setAll([{ name: "sb-auth", value: "new", options: { httpOnly: true, path: "/" } }], { "Cache-Control": "private, no-store" });
    return signedIn();
  };
  const req = request("/api/me", [{ name: "sb-auth", value: "old" }]);
  const res = await mod.proxy(req);
  assert.equal(res.kind, "next");
  assert.equal(res.forwarded, req);
  assert.equal(req.cookies.get("sb-auth").value, "new");
  assert.deepEqual(res.cookies.get("sb-auth"), { name: "sb-auth", value: "new", httpOnly: true, path: "/" });
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("a redirect carries cookie changes (e.g. a cleared session)", async () => {
  getClaims = async (cookies) => {
    await cookies.setAll([{ name: "sb-auth", value: "", options: { maxAge: 0 } }], { "Cache-Control": "private, no-store" });
    return signedOut();
  };
  const res = await mod.proxy(request("/", [{ name: "sb-auth", value: "stale" }]));
  assert.equal(res.kind, "redirect");
  assert.deepEqual(res.cookies.get("sb-auth"), { name: "sb-auth", value: "", maxAge: 0 });
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("an auth error counts as signed out", async () => {
  getClaims = async () => { throw new Error("network"); };
  assert.equal((await mod.proxy(request("/"))).kind, "redirect");
});

test("with no Supabase env: no client, pages redirect, api passes", async () => {
  assert.equal((await modNoEnv.proxy(request("/"))).kind, "redirect");
  assert.equal((await modNoEnv.proxy(request("/api/me"))).kind, "next");
  assert.equal(clientsCreated, 0);
});

test("matcher runs on pages and /api, skips static assets", () => {
  const matches = (url) => unstable_doesMiddlewareMatch({ config: mod.config, url });
  for (const url of ["/", "/login", "/challenges/abc", "/api/me", "/api/wallet-links/link", "/join/abc"]) {
    assert.equal(matches(url), true, url);
  }
  for (const url of ["/_next/static/chunks/a.js", "/_next/image?url=x", "/favicon.ico", "/manifest.webmanifest", "/icon", "/apple-icon", "/sw.js", "/x.png"]) {
    assert.equal(matches(url), false, url);
  }
});
