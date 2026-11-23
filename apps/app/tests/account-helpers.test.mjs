import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (file) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject, require: (n) => { throw new Error(n); }, URL });
  return exportsObject;
};

const { linkWalletMessage, unlinkWalletMessage } = load("lib/wallet-link-message.ts");
const { normalizeDisplayName } = load("lib/display-name.ts");
const { isSameOrigin } = load("lib/same-origin.ts");
const { safeNextPath } = load("lib/safe-next-path.ts");

test("link and unlink messages differ and carry the proof fields", () => {
  const p = { accountId: "acct-1", wallet: "Wallet111", nonce: "nonce-xyz", expiresAt: 1_800_000_000 };
  const link = linkWalletMessage(p);
  const unlink = unlinkWalletMessage(p);
  assert.notEqual(link, unlink);
  assert.notEqual(link.split("\n")[0], unlink.split("\n")[0]);
  for (const m of [link, unlink]) {
    assert.ok(m.startsWith("Moltivate:"));
    for (const v of [p.accountId, p.wallet, p.nonce, new Date(p.expiresAt * 1000).toISOString()]) assert.ok(m.includes(v), v);
  }
});

test("normalizeDisplayName", () => {
  assert.deepEqual({ ...normalizeDisplayName("  Ada   Lovelace ") }, { ok: true, name: "Ada Lovelace", key: "ada lovelace" });
  assert.equal(normalizeDisplayName("ＡＤＡ").key, "ada");
  assert.equal(normalizeDisplayName("Ada_L-1.2").ok, true);
  for (const bad of ["", "   ", "a".repeat(41), "a\u0000b", "a\nb", "<script>", "-x"]) {
    assert.equal(normalizeDisplayName(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(normalizeDisplayName("a".repeat(40)).ok, true);
});

test("isSameOrigin", () => {
  const url = "https://a.app/api/x";
  assert.equal(isSameOrigin("https://a.app", url), true);
  assert.equal(isSameOrigin("https://evil.app", url), false);
  assert.equal(isSameOrigin(null, url), false);
  assert.equal(isSameOrigin("https://a.app.evil.com", url), false);
  assert.equal(isSameOrigin("https://a.app", "not a url"), false);
});

test("safeNextPath", () => {
  assert.equal(safeNextPath("/challenges/x?y=1"), "/challenges/x?y=1");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "", null, undefined]) {
    assert.equal(safeNextPath(bad), "/", String(bad));
  }
});
