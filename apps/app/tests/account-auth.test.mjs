import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (file, requireFn) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: requireFn, Response, URL });
  return exportsObject;
};

const sameOrigin = load("lib/same-origin.ts", (n) => { throw new Error(n); });

// Per-test fake session state, read by the stubbed auth client.
let user;
let aal;
let aalError;
let aalArg;
const authClient = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: "tok" } }, error: null }),
    getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "no session" } }),
    mfa: { getAuthenticatorAssuranceLevel: async (jwt) => { aalArg = jwt; return aalError ? { data: null, error: aalError } : { data: aal, error: null }; } },
  },
};

const { requireAccount } = load("lib/account-auth.ts", (name) => {
  if (name === "./same-origin") return sameOrigin;
  if (name === "./supabase-auth") return { createAuthClient: () => authClient };
  throw new Error(name);
});

const URL_ = "https://app.test/api/x";
const post = (headers = {}) =>
  new Request(URL_, { method: "POST", headers: { origin: "https://app.test", "content-type": "application/json", ...headers }, body: "{}" });
const check = async (request) => {
  const result = await requireAccount(request);
  return result.ok ? result : { ok: false, status: result.response.status, body: await result.response.json() };
};

beforeEach(() => {
  user = { id: "u1", email: "a@b.co", email_confirmed_at: "2026-11-01T00:00:00Z", factors: [] };
  aal = { currentLevel: "aal1", nextLevel: "aal1" };
  aalError = undefined;
  aalArg = undefined;
});

test("GET with no session is 401", async () => {
  user = null;
  const res = await check(new Request(URL_));
  assert.deepEqual([res.status, res.body], [401, { error: "not signed in" }]);
});

test("POST from another origin is 403", async () => {
  const res = await check(post({ origin: "https://evil.app" }));
  assert.deepEqual([res.status, res.body], [403, { error: "cross-origin request refused" }]);
});

test("POST with no Origin is 403", async () => {
  const req = new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal((await check(req)).status, 403);
});

test("POST with a non-JSON content type is 415", async () => {
  assert.equal((await check(post({ "content-type": "text/plain" }))).status, 415);
});

test("unconfirmed email is 403", async () => {
  user.email_confirmed_at = null;
  const res = await check(post());
  assert.deepEqual([res.status, res.body], [403, { error: "verify your email first" }]);
});

const verifiedFactor = { id: "f1", status: "verified", factor_type: "totp" };

test("verified factor with an AAL1 token is 401", async () => {
  user.factors = [verifiedFactor];
  aal = { currentLevel: "aal1", nextLevel: "aal2" };
  const res = await check(post());
  assert.deepEqual([res.status, res.body], [401, { error: "two-step verification required" }]);
});

test("verified factor is enforced even when the cookie-derived AAL stub says nextLevel aal1", async () => {
  user.factors = [verifiedFactor];
  aal = { currentLevel: "aal1", nextLevel: "aal1" };
  const res = await check(post());
  assert.deepEqual([res.status, res.body], [401, { error: "two-step verification required" }]);
});

test("the AAL lookup is given the access token, not left to cookie contents", async () => {
  user.factors = [verifiedFactor];
  aal = { currentLevel: "aal2", nextLevel: "aal2" };
  await check(post());
  assert.equal(aalArg, "tok");
});

test("verified factor with an aal2 token returns the account", async () => {
  user.factors = [verifiedFactor];
  aal = { currentLevel: "aal2", nextLevel: "aal2" };
  const res = await check(post());
  assert.deepEqual({ ...res.account }, { userId: "u1", email: "a@b.co" });
});

test("an unverified factor does not require aal2", async () => {
  user.factors = [{ id: "f2", status: "unverified", factor_type: "totp" }];
  assert.equal((await check(post())).ok, true);
});

test("no factors: ok at aal1", async () => {
  const res = await check(post());
  assert.deepEqual({ ...res.account }, { userId: "u1", email: "a@b.co" });
});

test("AAL lookup error fails closed", async () => {
  user.factors = [verifiedFactor];
  aalError = { message: "boom" };
  const res = await check(post());
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test("GET skips the origin and content-type checks", async () => {
  const res = await check(new Request(URL_));
  assert.equal(res.ok, true);
});
