import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Loads the route the same way challenge-discovery.test.mjs loads lib/anchor.ts:
// transpile, then run with stubbed modules so no Supabase or network is touched.
let inserted;
let nextResult;
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
      return { PublicKey: class { constructor(v) { if (v === "bad") throw new Error("bad pubkey"); } } };
    }
    if (name === "@/lib/supabase-server") return { getSupabaseServerClient: () => fakeSupabase };
    throw new Error(name);
  },
});
const { POST } = exportsObject;

const valid = { challengePubkey: "c", teamMemberPubkey: "m", idempotencyKey: "k1", reps: 12, source: "browser_mediapipe" };
const post = (body, headers = {}) =>
  POST(new Request("http://x/api/workout-sessions", { method: "POST", headers, body: JSON.stringify(body) }));

beforeEach(() => {
  inserted = [];
  nextResult = { data: { id: "row-1" }, error: null };
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
