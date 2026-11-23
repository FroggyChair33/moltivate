import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Loads the route the same way challenge-discovery.test.mjs loads lib/anchor.ts:
// transpile, then run with stubbed modules so no Supabase or network is touched.
let inserted;
let nextResult;
let fakeProgram;
const fakeSupabase = {
  from: () => ({
    insert(row) {
      inserted.push(row);
      return { select: () => ({ single: async () => nextResult }) };
    },
  }),
};

const output = ts.transpileModule(fs.readFileSync("app/api/workout-sessions/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, {
  exports: exportsObject,
  process,
  Request,
  require(name) {
    if (name === "next/server") {
      return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
    }
    if (name === "@solana/web3.js") {
      return {
        PublicKey: class {
          constructor(v) { if (v === "bad") throw new Error("bad pubkey"); this.v = v; }
          equals(o) { return o.v === this.v; }
        },
      };
    }
    if (name === "@/lib/supabase-server") return { getSupabaseServerClient: () => fakeSupabase };
    if (name === "@/lib/server-program") return { getReadOnlyProgram: () => fakeProgram };
    throw new Error(name);
  },
});
const { POST } = exportsObject;

const valid = { challengePubkey: "c", teamMemberPubkey: "m", idempotencyKey: "k1", reps: 12, source: "browser_mediapipe" };
const post = (body, headers = {}) =>
  POST(new Request("http://x/api/workout-sessions", { method: "POST", headers, body: JSON.stringify(body) }));

const unix = (offsetSeconds) => ({ toNumber: () => Math.floor(Date.now() / 1000) + offsetSeconds });
let challengeAcc;
let memberAcc;
beforeEach(() => {
  inserted = [];
  nextResult = { data: { id: "row-1" }, error: null };
  challengeAcc = { settled: false, deadlineUnix: unix(3600) };
  memberAcc = { challenge: { equals: () => true } };
  fakeProgram = {
    account: {
      challenge: { fetchNullable: async () => challengeAcc },
      teamMember: { fetchNullable: async () => memberAcc },
    },
  };
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
  memberAcc = { challenge: { equals: () => false } };
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
