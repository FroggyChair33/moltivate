import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const output = ts.transpileModule(fs.readFileSync("lib/supabase-key.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, { exports: exportsObject, Buffer });
const { assertServiceKey, assertPublishableKey } = exportsObject;

const jwt = (payload) =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

test("accepts sb_secret keys", () => {
  assert.doesNotThrow(() => assertServiceKey("sb_secret_abc"));
});

test("accepts service_role JWTs", () => {
  assert.doesNotThrow(() => assertServiceKey(jwt({ role: "service_role" })));
});

test("rejects anon JWTs", () => {
  assert.throws(() => assertServiceKey(jwt({ role: "anon" })), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("rejects publishable keys", () => {
  assert.throws(() => assertServiceKey("sb_publishable_abc"), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("rejects unrecognized keys", () => {
  assert.throws(() => assertServiceKey("hello"), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("never echoes the key", () => {
  assert.throws(
    () => assertServiceKey("sb_publishable_SECRETVALUE"),
    (err) => !err.message.includes("SECRETVALUE"),
  );
});

test("publishable: accepts sb_publishable keys and anon JWTs", () => {
  assert.doesNotThrow(() => assertPublishableKey("sb_publishable_abc"));
  assert.doesNotThrow(() => assertPublishableKey(jwt({ role: "anon" })));
});

test("publishable: rejects sb_secret keys and service_role JWTs", () => {
  assert.throws(() => assertPublishableKey("sb_secret_x"), /PUBLISHABLE_KEY/);
  assert.throws(() => assertPublishableKey(jwt({ role: "service_role" })), /PUBLISHABLE_KEY/);
});

test("publishable: rejects unrecognized keys and never echoes the key", () => {
  assert.throws(() => assertPublishableKey("hello"), /PUBLISHABLE_KEY/);
  assert.throws(
    () => assertPublishableKey("sb_secret_SECRETVALUE"),
    (err) => !err.message.includes("SECRETVALUE"),
  );
});
