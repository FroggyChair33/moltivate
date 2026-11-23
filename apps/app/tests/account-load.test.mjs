import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const output = ts.transpileModule(fs.readFileSync("lib/account-load.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, { exports: exportsObject });
const { loadMe } = exportsObject;

const response = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
// Replays the given results in order; an Error is thrown as a network failure.
function fetcher(results) {
  const calls = { count: 0 };
  const fn = async () => {
    const next = results[Math.min(calls.count++, results.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}
// loadMe runs in a vm realm, so compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const waits = [];
const wait = async (ms) => { waits.push(ms); };

test("200 is signedIn with the body", async () => {
  const { fn, calls } = fetcher([response(200, { email: "a@example.test" })]);
  assert.deepEqual(plain(await loadMe(fn, wait)), { kind: "signedIn", me: { email: "a@example.test" } });
  assert.equal(calls.count, 1);
});

test("401 and 403 are signedOut without retrying", async () => {
  for (const status of [401, 403]) {
    const { fn, calls } = fetcher([response(status)]);
    assert.deepEqual(plain(await loadMe(fn, wait)), { kind: "signedOut" });
    assert.equal(calls.count, 1);
  }
});

test("a 5xx then success retries and signs in", async () => {
  const { fn, calls } = fetcher([response(500), response(200, { email: "b" })]);
  assert.deepEqual(plain(await loadMe(fn, wait)), { kind: "signedIn", me: { email: "b" } });
  assert.equal(calls.count, 2);
});

test("network failures and 5xx for every attempt end in error after 3 tries with growing backoff", async () => {
  waits.length = 0;
  const { fn, calls } = fetcher([new Error("offline"), response(503), response(502)]);
  assert.deepEqual(plain(await loadMe(fn, wait)), { kind: "error" });
  assert.equal(calls.count, 3);
  assert.equal(waits.length, 2, "no wait after the last attempt");
  assert.ok(waits[1] > waits[0]);
});

test("a 401 after a 5xx is signedOut", async () => {
  const { fn } = fetcher([response(500), response(401)]);
  assert.deepEqual(plain(await loadMe(fn, wait)), { kind: "signedOut" });
});
