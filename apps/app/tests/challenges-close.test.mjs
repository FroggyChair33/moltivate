import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

// Loads the route like workout-sessions.test.mjs: transpile, run with stubbed
// modules. requireAccount is the real lib/account-auth.ts over a fake auth
// client, so the Origin gate and the 401 are really exercised.
const require = createRequire(import.meta.url);
const web3 = require("@solana/web3.js");

const load = (file, requireFn) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: requireFn, process, Request, Response, URL, Buffer, TextEncoder, Uint8Array });
  return exportsObject;
};
const none = (n) => { throw new Error(n); };

let upserts;
let dbError; // what the fake database returns as `error` (null = success)
let closedRows;
let members;
let settled;
let user; // what the fake auth client says is signed in (null = signed out)
let linkedWallets; // called afresh on every request, like the real getLinkedWallets
const creatorPk = web3.Keypair.generate().publicKey;
const memberPk = web3.Keypair.generate().publicKey;
const outsiderPk = web3.Keypair.generate().publicKey;
const challengeA = web3.Keypair.generate().publicKey;

const sameOrigin = load("lib/same-origin.ts", none);
const authClient = { auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: null } }) } };
const account = load("lib/account-auth.ts", (n) => {
  if (n === "./same-origin") return sameOrigin;
  if (n === "./supabase-auth") return { createAuthClient: () => authClient };
  return none(n);
});
const { GET, POST } = load("app/api/challenges/close/route.ts", (name) => {
  if (name === "next/server") return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
  if (name === "@solana/web3.js") return web3;
  if (name === "@/lib/account-auth") return account;
  if (name === "@/lib/linked-wallets") return { getLinkedWallets: async () => linkedWallets() };
  if (name === "@/lib/server-program") {
    return { getReadOnlyProgram: () => ({ account: { challenge: { fetch: async () => ({ settled, creator: creatorPk }) } } }) };
  }
  if (name === "@/lib/anchor") return { fetchChallengeMembers: async () => members };
  if (name === "@/lib/supabase-server") {
    return {
      getSupabaseServerClient: () => ({
        from: () => ({
          upsert: async (row) => { upserts.push(row); return { error: dbError }; },
          select: () => ({ in: async () => (dbError ? { data: null, error: dbError } : { data: closedRows, error: null }) }),
        }),
      }),
    };
  }
  throw new Error(name);
});

const ORIGIN = "http://x";
const post = (body, headers = { origin: ORIGIN, "content-type": "application/json" }) =>
  POST(new Request(`${ORIGIN}/api/challenges/close`, { method: "POST", headers, body: JSON.stringify(body) }));
const valid = () => ({ challengePubkey: challengeA.toBase58() });

beforeEach(() => {
  upserts = [];
  dbError = null;
  closedRows = [];
  settled = true;
  members = [{ account: { owner: creatorPk, claimed: true } }, { account: { owner: memberPk, claimed: true } }];
  user = { id: "u1", email: "a@example.com", email_confirmed_at: "2026-01-01", factors: [] };
  linkedWallets = () => [creatorPk.toBase58()];
});

test("an account linked to the creator wallet closes, recording that wallet", async () => {
  const res = await post(valid());
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "closed");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].challenge_pubkey, challengeA.toBase58());
  assert.equal(upserts[0].closed_by, creatorPk.toBase58());
});

test("an account linked to a member wallet closes, recording that wallet", async () => {
  linkedWallets = () => [memberPk.toBase58()];
  const res = await post(valid());
  assert.equal(res.status, 200);
  assert.equal(upserts[0].closed_by, memberPk.toBase58());
});

test("closed_by prefers the creator wallet when both are linked", async () => {
  linkedWallets = () => [memberPk.toBase58(), creatorPk.toBase58()];
  assert.equal((await post(valid())).status, 200);
  assert.equal(upserts[0].closed_by, creatorPk.toBase58());
});

test("an account whose linked wallets are neither creator nor member is 403", async () => {
  linkedWallets = () => [outsiderPk.toBase58()];
  const res = await post(valid());
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "none of your linked wallets is the creator or a member of this challenge");
  linkedWallets = () => [];
  assert.equal((await post(valid())).status, 403);
  assert.equal(upserts.length, 0);
});

test("no session is 401 and nothing is closed", async () => {
  user = null;
  assert.equal((await post(valid())).status, 401);
  assert.equal(upserts.length, 0);
});

test("a wrong Origin is 403 and nothing is closed", async () => {
  const res = await post(valid(), { origin: "http://evil.example", "content-type": "application/json" });
  assert.equal(res.status, 403);
  assert.equal(upserts.length, 0);
});

test("a failing linked-wallet lookup is 503 and nothing is closed", async () => {
  linkedWallets = () => { throw new Error("db down"); };
  const res = await post(valid());
  assert.equal(res.status, 503);
  assert.equal(upserts.length, 0);
});

test("unlinking between two closes takes effect on the next request", async () => {
  assert.equal((await post(valid())).status, 200);
  linkedWallets = () => [];
  assert.equal((await post(valid())).status, 403);
  assert.equal(upserts.length, 1);
});

test("wallet and signature fields in the body grant nothing", async () => {
  linkedWallets = () => [outsiderPk.toBase58()];
  const res = await post({ ...valid(), wallet: creatorPk.toBase58(), signature: "AAAA" });
  assert.equal(res.status, 403);
  assert.equal(upserts.length, 0);
});

test("a missing or invalid challengePubkey is 400", async () => {
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ challengePubkey: "bad" })).status, 400);
  assert.equal(upserts.length, 0);
});

test("not settled is 400", async () => {
  settled = false;
  assert.equal((await post(valid())).status, 400);
  assert.equal(upserts.length, 0);
});

test("a challenge with no members is 400", async () => {
  members = [];
  assert.equal((await post(valid())).status, 400);
  assert.equal(upserts.length, 0);
});

test("a member who has not claimed is 400", async () => {
  members = [{ account: { owner: creatorPk, claimed: true } }, { account: { owner: memberPk, claimed: false } }];
  assert.equal((await post(valid())).status, 400);
  assert.equal(upserts.length, 0);
});

test("database errors are 500s with a generic message, never the database text", async () => {
  dbError = { message: "relation challenge_closures secret detail" };
  const posted = await post(valid());
  const got = await GET(new Request(`${ORIGIN}/api/challenges/close?challenges=${challengeA.toBase58()}`));
  for (const res of [posted, got]) {
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /secret detail|relation/);
  }
});

test("GET batch lookup stays public", async () => {
  closedRows = [{ challenge_pubkey: "c1" }];
  const res = await GET(new Request(`${ORIGIN}/api/challenges/close?challenges=c1,c2`));
  assert.equal(res.status, 200);
  assert.deepEqual([...res.body.closed], ["c1"]);
  assert.equal((await GET(new Request(`${ORIGIN}/api/challenges/close`))).status, 400);
});
