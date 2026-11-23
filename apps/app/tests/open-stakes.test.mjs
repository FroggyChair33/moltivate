import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const web3 = require("@solana/web3.js");

const load = (file, requireFn) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: requireFn });
  return exportsObject;
};

let memberships;
let challenges; // keyed by base58 id; undefined = account not found
const { hasOpenStake } = load("lib/open-stakes.ts", (name) => {
  if (name === "@solana/web3.js") return web3;
  if (name === "./anchor") return { fetchMemberships: async () => memberships };
  throw new Error(name);
});
const program = {
  account: {
    challenge: { fetchMultiple: async (keys) => keys.map((k) => challenges[k.toBase58()] ?? null) },
  },
};
const wallet = web3.Keypair.generate().publicKey;
const id = () => web3.Keypair.generate().publicKey;
const member = (challenge, claimed) => ({ account: { challenge, claimed } });

test("no memberships is false", async () => {
  memberships = [];
  challenges = {};
  assert.equal(await hasOpenStake(program, wallet), false);
});

test("a member of an unsettled challenge is open", async () => {
  const c = id();
  memberships = [member(c, false)];
  challenges = { [c.toBase58()]: { settled: false } };
  assert.equal(await hasOpenStake(program, wallet), true);
});

test("a settled challenge with an unclaimed payout is open", async () => {
  const c = id();
  memberships = [member(c, false)];
  challenges = { [c.toBase58()]: { settled: true } };
  assert.equal(await hasOpenStake(program, wallet), true);
});

test("settled and claimed is not open", async () => {
  const c = id();
  memberships = [member(c, true)];
  challenges = { [c.toBase58()]: { settled: true } };
  assert.equal(await hasOpenStake(program, wallet), false);
});

test("one open stake among settled ones is enough", async () => {
  const [a, b] = [id(), id()];
  memberships = [member(a, true), member(b, false)];
  challenges = { [a.toBase58()]: { settled: true }, [b.toBase58()]: { settled: true } };
  assert.equal(await hasOpenStake(program, wallet), true);
});

test("a missing challenge account fails closed", async () => {
  const c = id();
  memberships = [member(c, false)];
  challenges = {};
  assert.equal(await hasOpenStake(program, wallet), true);
});
