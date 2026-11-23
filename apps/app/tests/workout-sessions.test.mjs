import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

// Loads the route the same way challenge-discovery.test.mjs loads lib/anchor.ts:
// transpile, then run with stubbed modules so no Supabase or network is touched.
// Keys are real (web3.js). requireAccount is the real lib/account-auth.ts over a fake auth
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

let inserted;
let nextResult;
let fakeProgram;
let existingRow; // what a lookup by (member, idempotency key) finds
let user; // what the fake auth client says is signed in (null = signed out)
let linkedWallets; // called afresh on every request, like the real getLinkedWallets
const fakeSupabase = {
  from: () => ({
    insert(row) {
      inserted.push(row);
      return { select: () => ({ single: async () => nextResult }) };
    },
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => (existingRow === "error" ? { data: undefined, error: { message: "db" } } : { data: existingRow, error: null }) }) }) }),
  }),
};

const sameOrigin = load("lib/same-origin.ts", none);
const authClient = { auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: null } }) } };
const account = load("lib/account-auth.ts", (n) => {
  if (n === "./same-origin") return sameOrigin;
  if (n === "./supabase-auth") return { createAuthClient: () => authClient };
  return none(n);
});
const { POST } = load("app/api/workout-sessions/route.ts", (name) => {
  if (name === "next/server") {
    return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
  }
  if (name === "@solana/web3.js") return web3;
  if (name === "@/lib/account-auth") return account;
  if (name === "@/lib/linked-wallets") return { getLinkedWallets: async () => linkedWallets() };
  if (name === "@/lib/supabase-server") return { getSupabaseServerClient: () => fakeSupabase };
  if (name === "@/lib/server-program") return { getReadOnlyProgram: () => fakeProgram };
  throw new Error(name);
});

const walletPk = web3.Keypair.generate().publicKey;
const challengePk = web3.Keypair.generate().publicKey;
const memberPk = web3.Keypair.generate().publicKey;
const now = () => Math.floor(Date.now() / 1000);

const valid = {
  challengePubkey: challengePk.toBase58(),
  teamMemberPubkey: memberPk.toBase58(),
  idempotencyKey: "k1",
  reps: 12,
  source: "browser_mediapipe",
};
const ORIGIN = "http://x";
const post = (body, headers = { origin: ORIGIN, "content-type": "application/json" }) =>
  POST(new Request(`${ORIGIN}/api/workout-sessions`, { method: "POST", headers, body: JSON.stringify(body) }));

const unix = (offsetSeconds) => ({ toNumber: () => now() + offsetSeconds });
let challengeAcc;
let memberAcc;
beforeEach(() => {
  inserted = [];
  existingRow = null;
  user = { id: "u1", email: "a@example.com", email_confirmed_at: "2026-01-01", factors: [] };
  linkedWallets = () => [walletPk.toBase58()];
  nextResult = { data: { id: "row-1" }, error: null };
  challengeAcc = { settled: false, deadlineUnix: unix(3600) };
  memberAcc = { challenge: challengePk, owner: walletPk };
  fakeProgram = {
    account: {
      challenge: { fetchNullable: async () => challengeAcc },
      teamMember: { fetchNullable: async () => memberAcc },
    },
  };
});

test("a session from a linked wallet is recorded with the account id", async () => {
  const res = await post(valid);
  assert.equal(res.status, 201);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].account_id, "u1");
});

test("no session is 401 and nothing is inserted", async () => {
  user = null;
  assert.equal((await post(valid)).status, 401);
  assert.equal(inserted.length, 0);
});

test("a wrong Origin is 403 and nothing is inserted", async () => {
  const res = await post(valid, { origin: "http://evil.example", "content-type": "application/json" });
  assert.equal(res.status, 403);
  assert.equal(inserted.length, 0);
});

test("a member owned by a wallet outside the account's linked set is 403", async () => {
  linkedWallets = () => [web3.Keypair.generate().publicKey.toBase58()];
  assert.equal((await post(valid)).status, 403);
  linkedWallets = () => [];
  assert.equal((await post(valid)).status, 403);
  assert.equal(inserted.length, 0);
});

test("unlinking between two submissions takes effect on the next request", async () => {
  assert.equal((await post(valid)).status, 201);
  linkedWallets = () => [];
  assert.equal((await post({ ...valid, idempotencyKey: "k2" })).status, 403);
  assert.equal(inserted.length, 1);
});

test("a failing linked-wallet lookup fails closed with a 5xx", async () => {
  linkedWallets = () => { throw new Error("db down"); };
  const res = await post(valid);
  assert.ok(res.status >= 500, String(res.status));
  assert.equal(inserted.length, 0);
});

test("wallet and session-key fields in the body grant nothing", async () => {
  linkedWallets = () => [];
  const res = await post({ ...valid, wallet: walletPk.toBase58(), sessionKey: "y", authSignature: "z", signature: "w", expiresAt: now() + 60 });
  assert.equal(res.status, 403);
  assert.equal(inserted.length, 0);
});

test("rejects chert_facetime source", async () => {
  const res = await post({ ...valid, source: "chert_facetime" });
  assert.equal(res.status, 400);
  assert.equal(inserted.length, 0);
});

test("ignores caller-asserted trust", async () => {
  const res = await post({ ...valid, trustLevel: "verified", livenessResult: "pass" });
  assert.equal(res.status, 201);
  assert.equal(res.body.trustLevel, "unverified");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].trust_level, "unverified");
  assert.equal(inserted[0].liveness_result, "not_run");
  assert.equal(inserted[0].source, "browser_mediapipe");
  assert.equal(inserted[0].status, "accepted");
  assert.equal(inserted[0].reps, 12);
});

test("rejects non-integer or negative reps", async () => {
  for (const reps of [2.5, -1, "10", 10_001, 2_147_483_647]) {
    const res = await post({ ...valid, reps });
    assert.equal(res.status, 400, String(reps));
  }
  assert.equal(inserted.length, 0);
});

test("rejects invalid pubkeys", async () => {
  const res = await post({ ...valid, challengePubkey: "bad" });
  assert.equal(res.status, 400);
  assert.equal(inserted.length, 0);
});

test("duplicate idempotency key is not an error", async () => {
  nextResult = { data: null, error: { code: "23505", message: "dup" } };
  const res = await post(valid);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "duplicate");
});

test("a database error is a 500 with a generic message, never the database text", async () => {
  nextResult = { data: null, error: { code: "XX000", message: "relation workout_sessions secret detail" } };
  const res = await post(valid);
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /secret detail|relation/);
});

test("rejects empty or oversized idempotency keys", async () => {
  for (const idempotencyKey of ["", "   ", "k".repeat(201)]) {
    const res = await post({ ...valid, idempotencyKey });
    assert.equal(res.status, 400, JSON.stringify(idempotencyKey.slice(0, 5)));
  }
  assert.equal(inserted.length, 0);
});

test("unknown challenge is 404", async () => {
  challengeAcc = null;
  const res = await post(valid);
  assert.equal(res.status, 404);
  assert.equal(inserted.length, 0);
});

test("member of another challenge is 403", async () => {
  memberAcc = { challenge: web3.Keypair.generate().publicKey, owner: walletPk };
  assert.equal((await post(valid)).status, 403);
  memberAcc = null;
  assert.equal((await post(valid)).status, 403);
  assert.equal(inserted.length, 0);
});

test("rejects sessions after the deadline", async () => {
  challengeAcc = { settled: false, deadlineUnix: unix(-60) };
  const res = await post(valid);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /deadline/i);
  assert.equal(inserted.length, 0);
});

test("rejects sessions for a settled challenge", async () => {
  challengeAcc = { settled: true, deadlineUnix: unix(3600) };
  assert.equal((await post(valid)).status, 409);
  assert.equal(inserted.length, 0);
});

test("RPC failure is 503, not 403", async () => {
  fakeProgram.account.challenge.fetchNullable = async () => { throw new Error("rpc down"); };
  const res = await post(valid);
  assert.equal(res.status, 503);
  assert.equal(inserted.length, 0);
});

test("retry after the deadline of an already-saved session reports duplicate, not 409", async () => {
  challengeAcc = { settled: false, deadlineUnix: unix(-60) };
  existingRow = { id: "row-1" };
  const res = await post(valid);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "duplicate");
  assert.equal(inserted.length, 0);
});

test("retry after settlement of an already-saved session reports duplicate", async () => {
  challengeAcc = { settled: true, deadlineUnix: unix(-60) };
  existingRow = { id: "row-1" };
  assert.equal((await post(valid)).body.status, "duplicate");
});

test("a failed duplicate lookup still returns the 409", async () => {
  challengeAcc = { settled: false, deadlineUnix: unix(-60) };
  existingRow = "error";
  assert.equal((await post(valid)).status, 409);
});
