import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

// Loads the route the same way challenge-discovery.test.mjs loads lib/anchor.ts:
// transpile, then run with stubbed modules so no Supabase or network is touched.
// Keys and signatures are real (tweetnacl, web3.js).
const require = createRequire(import.meta.url);
const nacl = require("tweetnacl");
const web3 = require("@solana/web3.js");

const load = (file, requireFn) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: requireFn, process, Request, Buffer, TextEncoder, Uint8Array });
  return exportsObject;
};

let inserted;
let nextResult;
let fakeProgram;
let existingRow; // what a lookup by (member, idempotency key) finds
const fakeSupabase = {
  from: () => ({
    insert(row) {
      inserted.push(row);
      return { select: () => ({ single: async () => nextResult }) };
    },
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => (existingRow === "error" ? { data: undefined, error: { message: "db" } } : { data: existingRow, error: null }) }) }) }),
  }),
};

const auth = load("lib/workout-auth.ts", (n) => { throw new Error(n); });
const { POST } = load("app/api/workout-sessions/route.ts", (name) => {
  if (name === "next/server") {
    return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
  }
  if (name === "@solana/web3.js") return web3;
  if (name === "tweetnacl") return nacl;
  if (name === "@/lib/workout-auth") return auth;
  if (name === "@/lib/supabase-server") return { getSupabaseServerClient: () => fakeSupabase };
  if (name === "@/lib/server-program") return { getReadOnlyProgram: () => fakeProgram };
  throw new Error(name);
});

const wallet = nacl.sign.keyPair();
const walletPk = new web3.PublicKey(wallet.publicKey);
const session = nacl.sign.keyPair();
const challengePk = web3.Keypair.generate().publicKey;
const memberPk = web3.Keypair.generate().publicKey;
const now = () => Math.floor(Date.now() / 1000);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const sign = (message, secretKey) => b64(nacl.sign.detached(new TextEncoder().encode(message), secretKey));

const valid = {
  challengePubkey: challengePk.toBase58(),
  teamMemberPubkey: memberPk.toBase58(),
  idempotencyKey: "k1",
  reps: 12,
  source: "browser_mediapipe",
  wallet: walletPk.toBase58(),
  sessionKey: new web3.PublicKey(session.publicKey).toBase58(),
  expiresAt: now() + 3600,
};
// Adds both signatures for whatever the body says, as the browser would.
const signed = (body, walletSecret = wallet.secretKey, sessionSecret = session.secretKey) => ({
  ...body,
  authSignature: sign(auth.sessionAuthMessage({ wallet: body.wallet, sessionKey: body.sessionKey, challenge: body.challengePubkey, member: body.teamMemberPubkey, expiresAt: body.expiresAt }), walletSecret),
  signature: sign(auth.workoutMessage({ challenge: body.challengePubkey, member: body.teamMemberPubkey, idempotencyKey: body.idempotencyKey, reps: body.reps }), sessionSecret),
});
const postRaw = (body, headers = {}) =>
  POST(new Request("http://x/api/workout-sessions", { method: "POST", headers, body: JSON.stringify(body) }));
const post = (body, headers = {}) => postRaw(signed(body), headers);

const unix = (offsetSeconds) => ({ toNumber: () => now() + offsetSeconds });
let challengeAcc;
let memberAcc;
beforeEach(() => {
  inserted = [];
  existingRow = null;
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

test("valid signed session is recorded", async () => {
  const res = await post(valid);
  assert.equal(res.status, 201);
  assert.equal(inserted.length, 1);
});

test("missing session fields are 400", async () => {
  for (const field of ["wallet", "sessionKey", "expiresAt", "authSignature", "signature"]) {
    const body = signed(valid);
    delete body[field];
    assert.equal((await postRaw(body)).status, 400, field);
  }
  assert.equal(inserted.length, 0);
});

test("reps changed after signing are rejected", async () => {
  const res = await postRaw({ ...signed(valid), reps: 500 });
  assert.equal(res.status, 401);
  assert.equal(inserted.length, 0);
});

test("a session key the wallet never authorized is rejected", async () => {
  const other = nacl.sign.keyPair();
  const res = await postRaw(signed(valid, other.secretKey));
  assert.equal(res.status, 401);
  assert.equal(inserted.length, 0);
});

test("a submission not signed by the session key is rejected", async () => {
  const other = nacl.sign.keyPair();
  const res = await postRaw(signed(valid, wallet.secretKey, other.secretKey));
  assert.equal(res.status, 401);
  assert.equal(inserted.length, 0);
});

test("expired authorization is rejected", async () => {
  const res = await post({ ...valid, expiresAt: now() - 1 });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /expired/);
  assert.equal(inserted.length, 0);
});

test("authorization lasting longer than the session limit is rejected", async () => {
  const res = await post({ ...valid, expiresAt: now() + auth.SESSION_KEY_TTL_SECONDS + 600 });
  assert.equal(res.status, 400);
  assert.equal(inserted.length, 0);
});

test("malformed signature is 400", async () => {
  const res = await postRaw({ ...signed(valid), signature: "AAAA" });
  assert.equal(res.status, 400);
  assert.equal(inserted.length, 0);
});

test("a wallet that doesn't own the member account is 403", async () => {
  memberAcc = { challenge: challengePk, owner: web3.Keypair.generate().publicKey };
  const res = await post(valid);
  assert.equal(res.status, 403);
  assert.equal(inserted.length, 0);
});

test("rejects chert_facetime source", async () => {
  const res = await post({ ...valid, source: "chert_facetime" });
  assert.equal(res.status, 400);
  assert.equal(inserted.length, 0);
});

test("ignores caller-asserted trust", async () => {
  process.env.WORKOUT_INGEST_SECRET = "s";
  try {
    const res = await post({ ...valid, trustLevel: "verified", livenessResult: "pass" }, { authorization: "Bearer s" });
    assert.equal(res.status, 201);
    assert.equal(res.body.trustLevel, "unverified");
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].trust_level, "unverified");
    assert.equal(inserted[0].liveness_result, "not_run");
    assert.equal(inserted[0].source, "browser_mediapipe");
    assert.equal(inserted[0].status, "accepted");
    assert.equal(inserted[0].reps, 12);
  } finally {
    delete process.env.WORKOUT_INGEST_SECRET;
  }
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
