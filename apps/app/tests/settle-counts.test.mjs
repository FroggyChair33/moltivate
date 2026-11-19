import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const output = ts.transpileModule(fs.readFileSync("lib/settle-counts.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, { exports: exportsObject });
const { memberCount, U32_MAX } = exportsObject;

test("sums a member's session reps", () => {
  assert.equal(memberCount([{ reps: 10 }, { reps: 5 }]), 15);
  assert.equal(memberCount([]), 0);
});

test("clamps to u32 so settle() can always encode the count", () => {
  assert.equal(U32_MAX, 4_294_967_295);
  assert.equal(memberCount([{ reps: 2_147_483_647 }, { reps: 2_147_483_647 }, { reps: 10 }]), U32_MAX);
});
