import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nacl = require("tweetnacl");
const web3 = require("@solana/web3.js");

const load = (file, requireFn) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: requireFn, Request, Buffer, TextEncoder, Uint8Array });
  return exportsObject;
};

const messageModule = load("lib/close-challenge-message.ts", (n) => { throw new Error(n); });
const { closeChallengeMessage } = messageModule;

let upserts;
let members;
const creator = nacl.sign.keyPair();
const creatorPk = new web3.PublicKey(creator.publicKey);
const challengeA = web3.Keypair.generate().publicKey;
const challengeB = web3.Keypair.generate().publicKey;

const { POST } = load("app/api/challenges/close/route.ts", (name) => {
  if (name === "next/server") return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
  if (name === "@solana/web3.js") return web3;
  if (name === "tweetnacl") return nacl;
  if (name === "@/lib/close-challenge-message") return messageModule;
  if (name === "@/lib/server-program") {
    return { getReadOnlyProgram: () => ({ account: { challenge: { fetch: async () => ({ settled: true, creator: creatorPk }) } } }) };
  }
  if (name === "@/lib/anchor") return { fetchChallengeMembers: async () => members };
  if (name === "@/lib/supabase-server") {
    return { getSupabaseServerClient: () => ({ from: () => ({ upsert: async (row) => { upserts.push(row); return { error: null }; } }) }) };
  }
  throw new Error(name);
});

const sign = (secretKey, challenge) =>
  Buffer.from(nacl.sign.detached(new TextEncoder().encode(closeChallengeMessage(creatorPk.toBase58(), challenge.toBase58())), secretKey)).toString("base64");
const post = (body) =>
  POST(new Request("http://x/api/challenges/close", { method: "POST", body: JSON.stringify(body) }));
const base = () => ({ challengePubkey: challengeA.toBase58(), wallet: creatorPk.toBase58() });

beforeEach(() => {
  upserts = [];
  members = [{ account: { owner: creatorPk, claimed: true } }];
});

test("valid creator signature closes", async () => {
  const res = await post({ ...base(), signature: sign(creator.secretKey, challengeA) });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "closed");
  assert.equal(upserts.length, 1);
});

test("missing signature is 400", async () => {
  const res = await post(base());
  assert.equal(res.status, 400);
  assert.equal(upserts.length, 0);
});

test("signature by another key is 401", async () => {
  const res = await post({ ...base(), signature: sign(nacl.sign.keyPair().secretKey, challengeA) });
  assert.equal(res.status, 401);
  assert.equal(upserts.length, 0);
});

test("signature for another challenge is rejected", async () => {
  const res = await post({ ...base(), signature: sign(creator.secretKey, challengeB) });
  assert.equal(res.status, 401);
  assert.equal(upserts.length, 0);
});

test("existing claim gate still applies", async () => {
  members = [{ account: { owner: creatorPk, claimed: false } }];
  const res = await post({ ...base(), signature: sign(creator.secretKey, challengeA) });
  assert.equal(res.status, 400);
  assert.equal(upserts.length, 0);
});
