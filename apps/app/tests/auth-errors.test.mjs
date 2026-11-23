import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (file) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, { exports: exportsObject });
  return exportsObject;
};
const { isNeutralAuthError } = load("lib/auth-errors.ts");

const rateLimited = { code: "over_email_send_rate_limit", status: 429 };

test("no error is the neutral result", () => {
  assert.equal(isNeutralAuthError(null, "signup"), true);
  assert.equal(isNeutralAuthError(null, "recover"), true);
});

test("a rate limit (known address emailed recently) looks like success in both flows", () => {
  assert.equal(isNeutralAuthError(rateLimited, "recover"), true);
  assert.equal(isNeutralAuthError(rateLimited, "signup"), true);
  assert.equal(isNeutralAuthError({ status: 429 }, "signup"), true);
});

test("existing-account and other server errors look like success", () => {
  for (const error of [{ code: "user_already_exists", status: 422 }, { code: "email_exists", status: 422 }, { code: "unexpected_failure", status: 500 }]) {
    assert.equal(isNeutralAuthError(error, "signup"), true, error.code);
    assert.equal(isNeutralAuthError(error, "recover"), true, error.code);
  }
});

test("weak_password is shown on sign-up (checked before any account lookup)", () => {
  assert.equal(isNeutralAuthError({ code: "weak_password", status: 422 }, "signup"), false);
  assert.equal(isNeutralAuthError({ code: "weak_password", status: 422 }, "recover"), true);
});

test("a network failure (no HTTP status) is shown: the server never answered", () => {
  assert.equal(isNeutralAuthError({ status: 0 }, "signup"), false);
  assert.equal(isNeutralAuthError({}, "recover"), false);
});
