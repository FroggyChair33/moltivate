import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Routes are transpiled and run with stubbed I/O. requireAccount is the real lib/account-auth.ts over a fake auth
// client, so the Origin gate is really exercised; the service client is an in-memory fake of profiles/linked_wallets.
const load = (file, requireFn) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: requireFn, Request, Response, URL, Date });
  return exportsObject;
};
const none = (n) => { throw new Error(n); };

let user;
let profiles; // rows: { user_id, display_name, display_name_key }
let linked; // rows: { wallet_address, user_id }
let inserts;
let metadata; // what auth.admin.getUserById returns as user_metadata
let adminFails;
let adminCalls;

const dupKey = (row) => profiles.some((p) => p.display_name_key === row.display_name_key && p.user_id !== row.user_id);
const tables = () => ({ profiles, linked_wallets: linked });
const builder = (table) => {
  const filters = [];
  const run = () => tables()[table].filter((r) => filters.every((f) => f(r)));
  const q = {
    select: () => q,
    eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
    in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return q; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    insert: async (row) => {
      inserts.push(row);
      if (dupKey(row) || profiles.some((p) => p.user_id === row.user_id)) return { error: { code: "23505", message: "duplicate" } };
      profiles.push({ ...row });
      return { error: null };
    },
    upsert: async (row) => {
      if (dupKey(row)) return { error: { code: "23505", message: "duplicate" } };
      const i = profiles.findIndex((p) => p.user_id === row.user_id);
      if (i >= 0) profiles[i] = { ...profiles[i], ...row };
      else profiles.push({ ...row });
      return { error: null };
    },
    then: (resolve) => resolve({ data: run(), error: null }),
  };
  return q;
};
const serverModule = {
  getSupabaseServerClient: () => ({
    from: builder,
    auth: {
      admin: {
        getUserById: async () => {
          adminCalls += 1;
          if (adminFails) throw new Error("admin down");
          return { data: { user: { user_metadata: metadata } }, error: null };
        },
      },
    },
  }),
};

const displayName = load("lib/display-name.ts", none);
const sameOrigin = load("lib/same-origin.ts", none);
const authClient = { auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: null } }) } };
const account = load("lib/account-auth.ts", (n) => {
  if (n === "./same-origin") return sameOrigin;
  if (n === "./supabase-auth") return { createAuthClient: () => authClient };
  return none(n);
});
const linkedModule = load("lib/linked-wallets.ts", (n) => (n === "./supabase-server" ? serverModule : none(n)));
const profile = load("lib/profile.ts", (n) => {
  if (n === "./supabase-server") return serverModule;
  if (n === "./display-name") return displayName;
  return none(n);
});
const appRequire = (n) => {
  if (n === "next/server") return { connection: async () => {} };
  if (n === "@/lib/account-auth") return account;
  if (n === "@/lib/linked-wallets") return linkedModule;
  if (n === "@/lib/profile") return profile;
  if (n === "@/lib/display-name") return displayName;
  if (n === "@/lib/supabase-server") return serverModule;
  return none(n);
};
const me = load("app/api/me/route.ts", appRequire);
const profileRoute = load("app/api/profile/route.ts", appRequire);
const available = load("app/api/profile/name-available/route.ts", appRequire);
const users = load("app/api/users/route.ts", appRequire);

const ORIGIN = "http://x";
const post = (body, origin = ORIGIN) =>
  profileRoute.POST(new Request(`${ORIGIN}/api/profile`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
const getJson = async (res) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  user = { id: "u1", email: "a@example.com", email_confirmed_at: "2026-01-01", factors: [] };
  profiles = [];
  linked = [];
  inserts = [];
  metadata = { display_name: "Ada" };
  adminFails = false;
  adminCalls = 0;
});

test("ensureProfile creates a profile from a valid metadata name", async () => {
  assert.deepEqual({ ...(await profile.ensureProfile("u1", "  Ada ")) }, { displayName: "Ada" });
  assert.equal(profiles[0].display_name_key, "ada");
});

test("ensureProfile rejects a hostile metadata name without inserting", async () => {
  for (const bad of ["<script>alert(1)</script>", 42, null, undefined, { a: 1 }]) {
    assert.deepEqual({ ...(await profile.ensureProfile("u1", bad)) }, { displayName: null });
  }
  assert.equal(inserts.length, 0);
});

test("ensureProfile returns null on a unique violation and does not throw", async () => {
  profiles.push({ user_id: "u2", display_name: "Ada", display_name_key: "ada" });
  assert.deepEqual({ ...(await profile.ensureProfile("u1", "ADA")) }, { displayName: null });
  assert.equal(profiles.length, 1);
});

test("ensureProfile returns an existing profile without touching the metadata", async () => {
  profiles.push({ user_id: "u1", display_name: "Grace", display_name_key: "grace" });
  assert.deepEqual({ ...(await profile.ensureProfile("u1", "Ada")) }, { displayName: "Grace" });
  assert.equal(inserts.length, 0);
});

test("GET /api/me returns email, name and both linked wallets", async () => {
  linked.push({ wallet_address: "W1", user_id: "u1" }, { wallet_address: "W2", user_id: "u1" }, { wallet_address: "W3", user_id: "u2" });
  const { status, body } = await getJson(await me.GET(new Request(`${ORIGIN}/api/me`)));
  assert.equal(status, 200);
  assert.deepEqual(body, { email: "a@example.com", displayName: "Ada", needsDisplayName: false, wallets: ["W1", "W2"] });
});

test("GET /api/me reports needsDisplayName when the metadata name is unusable or the admin lookup fails", async () => {
  metadata = { display_name: "<b>x</b>" };
  let r = await getJson(await me.GET(new Request(`${ORIGIN}/api/me`)));
  assert.equal(r.body.displayName, null);
  assert.equal(r.body.needsDisplayName, true);
  adminFails = true;
  r = await getJson(await me.GET(new Request(`${ORIGIN}/api/me`)));
  assert.equal(r.status, 200);
  assert.equal(r.body.needsDisplayName, true);
});

test("GET /api/me skips the admin lookup when a profile exists", async () => {
  profiles.push({ user_id: "u1", display_name: "Grace", display_name_key: "grace" });
  const { body } = await getJson(await me.GET(new Request(`${ORIGIN}/api/me`)));
  assert.equal(body.displayName, "Grace");
  assert.equal(adminCalls, 0);
});

test("GET /api/me logged out is 401", async () => {
  user = null;
  assert.equal((await me.GET(new Request(`${ORIGIN}/api/me`))).status, 401);
});

test("POST /api/profile with a wrong Origin is 403", async () => {
  assert.equal((await post({ displayName: "Ada" }, "http://evil")).status, 403);
  assert.equal(profiles.length, 0);
});

test("POST /api/profile trims and stores the name and its key", async () => {
  const { status, body } = await getJson(await post({ displayName: "  Ada " }));
  assert.equal(status, 200);
  assert.equal(body.displayName, "Ada");
  assert.deepEqual({ ...profiles[0] }, { user_id: "u1", display_name: "Ada", display_name_key: "ada" });
});

test("POST /api/profile renames an existing profile", async () => {
  profiles.push({ user_id: "u1", display_name: "Ada", display_name_key: "ada" });
  assert.equal((await post({ displayName: "Grace" })).status, 200);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].display_name, "Grace");
});

test("POST /api/profile taken name is 409, invalid or missing name is 400", async () => {
  profiles.push({ user_id: "u2", display_name: "Ada", display_name_key: "ada" });
  assert.equal((await post({ displayName: "ADA" })).status, 409);
  assert.equal((await post({ displayName: "<script>" })).status, 400);
  assert.equal((await post({ displayName: 5 })).status, 400);
  assert.equal((await post({})).status, 400);
});

test("GET /api/profile/name-available", async () => {
  profiles.push({ user_id: "u2", display_name: "Ada", display_name_key: "ada" });
  const get = async (name) => getJson(await available.GET(new Request(`${ORIGIN}/api/profile/name-available?name=${encodeURIComponent(name)}`)));
  assert.deepEqual((await get("ada")).body, { available: false });
  assert.deepEqual((await get("Grace")).body, { available: true });
  const bad = await get("<b>");
  assert.equal(bad.body.available, false);
  assert.equal(typeof bad.body.error, "string");
  assert.equal((await getJson(await available.GET(new Request(`${ORIGIN}/api/profile/name-available`)))).body.available, false);
});

test("GET /api/users maps linked wallets to names and omits unlinked ones", async () => {
  profiles.push({ user_id: "u1", display_name: "Ada", display_name_key: "ada" });
  linked.push({ wallet_address: "W1", user_id: "u1" }, { wallet_address: "W2", user_id: "u1" });
  const { status, body } = await getJson(await users.GET(new Request(`${ORIGIN}/api/users?wallets=W1,W2,W9`)));
  assert.equal(status, 200);
  assert.deepEqual(body, { names: { W1: "Ada", W2: "Ada" } });
});

test("GET /api/users rejects a missing list and more than 100 wallets", async () => {
  assert.equal((await users.GET(new Request(`${ORIGIN}/api/users`))).status, 400);
  const many = Array.from({ length: 101 }, (_, i) => `W${i}`).join(",");
  assert.equal((await users.GET(new Request(`${ORIGIN}/api/users?wallets=${many}`))).status, 400);
  const ok = Array.from({ length: 100 }, (_, i) => `W${i}`).join(",");
  assert.equal((await users.GET(new Request(`${ORIGIN}/api/users?wallets=${ok}`))).status, 200);
});

test("the old POST /api/users is gone", () => {
  assert.equal(users.POST, undefined);
});
