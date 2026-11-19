import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const output = ts.transpileModule(fs.readFileSync("lib/send-tx.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, { exports: exportsObject, JSON });
const { sendWithPhases } = exportsObject;

function fakes({ sendError, chainErr = null } = {}) {
  const calls = { confirm: null };
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: "bh", lastValidBlockHeight: 100 }),
    confirmTransaction: async (strategy, commitment) => {
      calls.confirm = { strategy, commitment };
      return { value: { err: chainErr } };
    },
  };
  const sendTransaction = async () => {
    if (sendError) throw sendError;
    return "sig";
  };
  return { connection, sendTransaction, calls };
}

test("reports approve then confirm and returns the signature", async () => {
  const { connection, sendTransaction } = fakes();
  const tx = {};
  const phases = [];
  const sig = await sendWithPhases(connection, sendTransaction, tx, (p) => phases.push(p));
  assert.deepEqual(phases, ["approve", "confirm"]);
  assert.equal(sig, "sig");
  assert.equal(tx.recentBlockhash, "bh");
});

test("confirm uses the same blockhash", async () => {
  const { connection, sendTransaction, calls } = fakes();
  await sendWithPhases(connection, sendTransaction, {}, () => {});
  // Spread: the object was created inside the vm realm (different Object.prototype).
  assert.deepEqual({ ...calls.confirm.strategy }, { signature: "sig", blockhash: "bh", lastValidBlockHeight: 100 });
  assert.equal(calls.confirm.commitment, "confirmed");
});

test("wallet rejection propagates and never reaches confirm", async () => {
  const { connection, sendTransaction, calls } = fakes({ sendError: new Error("User rejected") });
  const phases = [];
  await assert.rejects(sendWithPhases(connection, sendTransaction, {}, (p) => phases.push(p)), /User rejected/);
  assert.deepEqual(phases, ["approve"]);
  assert.equal(calls.confirm, null);
});

test("on-chain error throws", async () => {
  const { connection, sendTransaction } = fakes({ chainErr: { InstructionError: [0, "x"] } });
  await assert.rejects(sendWithPhases(connection, sendTransaction, {}, () => {}), /failed on chain/);
});

const { describeTxError } = exportsObject;
const idlErrors = [{ code: 6008, name: "DeadlinePassed", msg: "Challenge's join/deposit deadline has passed" }];

test("describeTxError maps an on-chain Custom code to the IDL error", () => {
  const err = new Error('transaction failed on chain: {"InstructionError":[0,{"Custom":6008}]}');
  assert.match(describeTxError(err, idlErrors), /^DeadlinePassed: Challenge's join\/deposit deadline has passed$/);
});

test("describeTxError maps a hex custom program error from wallet simulation", () => {
  const err = new Error("Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1778");
  assert.match(describeTxError(err, idlErrors), /^DeadlinePassed:/);
});

test("describeTxError leaves other errors unchanged", () => {
  assert.equal(describeTxError(new Error("User rejected the request."), idlErrors), "User rejected the request.");
  assert.equal(describeTxError(new Error('{"Custom":1}'), idlErrors), '{"Custom":1}');
  assert.equal(describeTxError("plain string", idlErrors), "plain string");
});
