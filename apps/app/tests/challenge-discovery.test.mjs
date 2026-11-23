import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

class PublicKey {
  constructor(value) { this.value = value; }
  toBase58() { return this.value; }
  equals(other) { return this.value === other.value; }
}

const output = ts.transpileModule(fs.readFileSync("lib/anchor.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, {
  exports: exportsObject,
  require(name) {
    if (name === "@coral-xyz/anchor") return { BN: class {} };
    if (name === "@solana/web3.js") return { PublicKey };
    if (name.endsWith(".json")) return { address: "program" };
    throw new Error(name);
  },
});
const { fetchWalletChallenges, mergeWalletChallenges } = exportsObject;
const owner = new PublicKey("creator");
const entry = (id, settled = false) => ({
  publicKey: new PublicKey(id), account: { creator: owner, settled },
});

test("creator-only, member-only, deduplication and settled claims remain discoverable", async () => {
  const created = [entry("created"), entry("both"), entry("settled", true)];
  const memberships = ["member", "both", "settled"].map((id) => ({
    account: { challenge: new PublicKey(id), claimed: false },
  }));
  const program = { account: {
    challenge: {
      all: async (filters) => {
        assert.equal(filters[0].memcmp.offset, 8);
        assert.equal(filters[0].memcmp.bytes, "creator");
        return created;
      },
      fetchMultiple: async (keys) => {
        assert.deepEqual(Array.from(keys, (key) => key.value), ["member"]);
        return [{ creator: new PublicKey("other"), settled: false }];
      },
    },
    teamMember: { all: async (filters) => {
      assert.equal(filters[0].memcmp.offset, 72);
      return memberships;
    } },
  } };
  const result = await fetchWalletChallenges(program, owner);
  assert.equal(result.length, 4);
  assert.equal(result.filter((row) => row.id === "both").length, 1);
  assert.equal(result.find((row) => row.id === "created").creator, true);
  assert.equal(result.find((row) => row.id === "member").creator, false);
  assert.equal(result.find((row) => row.id === "settled").claimPending, true);
  memberships[2].account.claimed = true;
  assert.equal((await fetchWalletChallenges(program, owner)).find((row) => row.id === "settled").claimPending, false);
});

test("RPC failures propagate instead of producing an empty list", async () => {
  const program = { account: {
    challenge: { all: async () => { throw new Error("RPC unavailable"); } },
    teamMember: { all: async () => [] },
  } };
  await assert.rejects(fetchWalletChallenges(program, owner), /RPC unavailable/);
});

test("merging wallet lists keeps one row per challenge and any-wallet flags", () => {
  const row = (id, extra = {}) => ({ id, settled: false, creator: false, claimPending: false, ...extra });
  const merged = mergeWalletChallenges([
    [row("both"), row("only-a", { settled: true })],
    [row("both", { creator: true, claimPending: true }), row("only-b")],
  ]);
  // Array.from: the helper runs in a vm context, so its arrays have another realm's prototype.
  assert.deepEqual(Array.from(merged, (r) => r.id).sort(), ["both", "only-a", "only-b"]);
  const both = merged.find((r) => r.id === "both");
  assert.equal(both.creator, true);
  assert.equal(both.claimPending, true);
  assert.equal(merged.find((r) => r.id === "only-a").settled, true);
  assert.equal(merged.find((r) => r.id === "only-b").creator, false);
  assert.equal(mergeWalletChallenges([]).length, 0);
});
