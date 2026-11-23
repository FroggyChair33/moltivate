# Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps found during the solo-fork cleanup and the first live devnet run. The fixes cover workout API validation, authenticated challenge close, the Supabase key mix-up, the RLS migration, the Phantom approval states, the scoreboard dead end, stale docs and a CI job for the Rust tests.

**Architecture:** Server checks live in the existing API routes. They read on-chain state through `getReadOnlyProgram()` with `fetchNullable`, so a missing account and an RPC failure are told apart. Two small pure modules (`lib/supabase-key.ts`, `lib/send-tx.ts`) hold the logic that needs tests. They're tested with the existing transpile-and-`vm` harness used by `tests/workout-sessions.test.mjs`. No program, IDL or settlement-math changes.

**Tech Stack:** Next.js 16.4.6, `@coral-xyz/anchor` 0.32.1, `@solana/web3.js` 1.x, `@solana/wallet-adapter-react`, `tweetnacl`, node:test, GitHub Actions, Rust/cargo (program unit tests only).

**Spec:** `AGENTS.md`, sections "Verification, authentication and data", "UX expectations" and "Verification expectations". The gaps list is in Stephen's memory note, items 1–9, copied below.

## Global Constraints

- Don't change settlement rules, trust tiers, payout logic, the Anchor program or `lib/idl/`.
- Every stored session stays `trust_level: 'unverified'`. Never add a path that raises it.
- Never print, log or commit a secret. Tests use fake keys only.
- Before finishing each task: `npm run lint`, `npm test` and `npm run build` in `apps/app`, plus root `npm run ci`.
- Branch: `follow-up-fixes`, cut from `readme-live-url` (which holds 2 unpushed doc commits). Don't push or deploy unless Stephen asks.
- HTTP codes for new rejections: unknown challenge **404**, not a member **403**, settled or past deadline **409**, RPC failure while checking **503**.

## Gaps → tasks

| Gap (memory note) | Task |
| --- | --- |
| 1. Workout API: no membership/deadline check, empty idempotency key | 2 |
| 2. Close authorizes by an unsigned wallet string | 3 |
| 3. Program README/recovery.md stale; 4. `apps/app/README.md` boilerplate | 6 |
| 5. No CI for `math.rs` tests | 7 |
| 6. Migrations never enable RLS; 9. anon key used as the service key | 1 |
| 7. Scoreboard dead end for non-members | 5 |
| 8. "Depositing..." hangs if Phantom never answers | 4 |

## Rulings made while planning (reviewed by Stephen 2026-11-20)

Stephen accepted the close-signature ruling. He **deferred** the other two as open design problems to solve better later. This plan ships the behaviour described below as an interim state and states the limit in code comments and the README.

- **The membership check confirms the challenge and member pair; it does not authenticate the caller.** It rejects reps for a member account that doesn't belong to the challenge, and after the deadline or settlement. It doesn't prove the caller *is* that member. Proving that needs a wallet signature on every workout, which means a Phantom prompt per set. Browser reps are already untrusted, so that costs more than it protects. The route comment and the README say so.
- **The close signature is replay-safe without an expiry**, the same as display names. The signed text binds the wallet and the challenge, and closing is idempotent, so replaying a captured signature only repeats a close that already happened. AGENTS.md asks for expiring, single-use messages; this deviation and its reason are recorded in the route comment.
- **Cancelling while Phantom is open can't withdraw the wallet request.** If Phantom approves later, the transaction still lands. For deposit that's harmless: `join_team` can only succeed once per wallet. For create, it can leave one extra empty challenge. This is stated in a code comment.

## Review Focus

1. A workout submitted just after the deadline (the user finished a set as time ran out) → 409 with a readable message, which the session UI already shows. → Task 2 test `rejects sessions after the deadline`.
2. The RPC fails while checking membership → 503, **not** "not a member". → Task 2 test `RPC failure is 503, not 403`.
3. A close signature captured for challenge A is replayed for challenge B → 401. → Task 3 test `signature for another challenge is rejected`.
4. A valid new-style `sb_secret_…` key, or a legacy `service_role` JWT, must still be accepted. Only anon/publishable keys are refused. → Task 1 tests.
5. Phantom answers *after* the user pressed Cancel → the late result must not overwrite the reset UI. → Task 4: the component ignores results from stale attempts (manual check, Step 6).

---

### Task 1: Refuse non-service Supabase keys; add the RLS migration

**Files:**
- Create: `apps/app/lib/supabase-key.ts`, `apps/app/tests/supabase-key.test.mjs`, `supabase/migrations/20261120010000_enable_rls.sql`
- Modify: `apps/app/lib/supabase-server.ts`, `apps/app/DEPLOYMENT.md` (env table note)

**Interfaces:**
- Produces: `assertServiceKey(key: string): void`. It throws `Error` with a message naming the variable, never the value.

- [ ] **Step 1: Write the failing tests** in `tests/supabase-key.test.mjs`, using the transpile+`vm` loader with no requires. Build fake JWTs as `header.base64url(JSON payload).sig`.
  - `accepts sb_secret keys`: `assertServiceKey("sb_secret_abc")` does not throw.
  - `accepts service_role JWTs`: payload `{"role":"service_role"}` does not throw.
  - `rejects anon JWTs`: payload `{"role":"anon"}` throws `/SUPABASE_SERVICE_ROLE_KEY/`.
  - `rejects publishable keys`: `"sb_publishable_abc"` throws.
  - `rejects unrecognized keys`: `"hello"` throws.
  - `never echoes the key`: the error message for `"sb_publishable_SECRETVALUE"` does not include `"SECRETVALUE"`.
- [ ] **Step 2:** Run `npm test` in `apps/app`. Expected: the new file fails (module missing).
- [ ] **Step 3:** Implement `assertServiceKey`. It accepts the `sb_secret_` prefix, or a 3-part JWT whose base64url-decoded payload has `role === "service_role"`; it rejects anything else. In `getSupabaseServerClient()`, call it after the existing presence check.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Migration.** Add `alter table <t> enable row level security;` for each of the 9 tables: `users`, `challenges`, `teams`, `team_members`, `workout_sessions`, `group_pots`, `settlements`, `member_payouts`, `closed_challenges`. Add a header comment: no policies on purpose, because only the server touches these tables, using the service-role key, which bypasses RLS. The statement is idempotent; Stephen's live project already has it applied.
- [ ] **Step 6:** In `DEPLOYMENT.md`, under the `SUPABASE_SERVICE_ROLE_KEY` row, note that the app refuses to start a request with an anon or publishable key.
- [ ] **Step 7:** Run lint, test, build and root ci. Commit `feat(app): refuse non-service Supabase keys; migration enables RLS`.

### Task 2: Workout sessions check membership, deadline and the idempotency key

**Files:** Modify `apps/app/app/api/workout-sessions/route.ts`, `apps/app/tests/workout-sessions.test.mjs`

**Interfaces:**
- Consumes: `getReadOnlyProgram()` from `@/lib/server-program`; `program.account.challenge.fetchNullable(pk)` gives `{ settled: boolean, deadlineUnix: { toNumber(): number } } | null`, and `program.account.teamMember.fetchNullable(pk)` gives `{ challenge: { equals(pk): boolean } } | null`.

- [ ] **Step 1: Extend the test harness.** Stub `"@/lib/server-program"` with `getReadOnlyProgram: () => fakeProgram`. In `beforeEach`, `fakeProgram` returns a challenge with `settled: false` and `deadlineUnix` one hour from now, plus a member whose `challenge.equals` returns true. Give the `PublicKey` stub an `equals` method. Existing tests must keep passing unchanged.
- [ ] **Step 2: Add the failing tests:**
  - `rejects empty or oversized idempotency keys`: `""`, `"   "` and `"k".repeat(201)` each give 400, with nothing inserted.
  - `unknown challenge is 404`: challenge `fetchNullable` gives null → 404.
  - `member of another challenge is 403`: `member.challenge.equals` gives false → 403. Also a missing member (null) → 403.
  - `rejects sessions after the deadline`: `deadlineUnix` 60s ago → 409, `body.error` matches `/deadline/i`.
  - `rejects sessions for a settled challenge`: `settled: true` → 409.
  - `RPC failure is 503, not 403`: `fetchNullable` rejects with an error → 503, nothing inserted.
- [ ] **Step 3:** Run `npm test`. Expected: the new tests fail.
- [ ] **Step 4: Implement.** After pubkey validation and before the insert:
  - Reject an idempotency key that is empty after trimming, or longer than 200 characters.
  - Fetch the challenge and the member with `Promise.all` of `fetchNullable`; a thrown error → 503 `{ error: "could not verify challenge membership; retry" }`.
  - Then: null challenge → 404; null member or wrong challenge → 403; settled → 409; `Date.now()/1000 >= deadlineUnix` → 409 `"challenge deadline has passed"`.
  - Add one line to the header comment that this validates the pair, not the caller (see Rulings).
- [ ] **Step 5:** Run lint, test, build and root ci. Commit `feat(api): workout sessions require challenge membership, an open deadline and a real idempotency key`.

### Task 3: Closing a challenge needs a wallet signature

**Files:**
- Create: `apps/app/lib/close-challenge-message.ts`, `apps/app/tests/challenges-close.test.mjs`
- Modify: `apps/app/app/api/challenges/close/route.ts` (POST only), `apps/app/app/challenges/[id]/results/client.tsx` (the close handler around line 135)

**Interfaces:**
- Produces: `closeChallengeMessage(wallet: string, challenge: string): string`, returning exactly `` `Moltivate: close challenge ${challenge} for ${wallet}` ``. The POST body gains `signature: string` (base64).

- [ ] **Step 1: Write the failing tests.** Load `close/route.ts` with the vm harness. Stubs:
  - `next/server`: as in the workout test.
  - `@solana/web3.js`: the real module, via `createRequire`.
  - `tweetnacl`: real.
  - `@/lib/close-challenge-message`: the transpiled real file.
  - `@/lib/server-program` and `@/lib/anchor`: fakes. The challenge is settled, the creator is the test keypair, and one member has `claimed: true`.
  - `@/lib/supabase-server`: records the upsert.

  Use `nacl.sign.keyPair()` for the wallet.

  Tests:
  - `valid creator signature closes`: 200 `{status:"closed"}`, with the upsert recorded.
  - `missing signature is 400`.
  - `signature by another key is 401`.
  - `signature for another challenge is rejected`: sign the message for challenge B and post for challenge A → 401.
  - `existing claim gate still applies`: a member with `claimed: false` → 400.
- [ ] **Step 2:** Run `npm test`. Expected: the new file fails.
- [ ] **Step 3: Implement.**
  - Add the message helper.
  - In POST, require a string `signature`. Verify it with `nacl.sign.detached.verify` inside a try block: a malformed signature → 400, a mismatch → 401. This is the same pattern as `app/api/users/route.ts`. Do the check before the on-chain reads.
  - Replace the header comment's "rather than a signed message" paragraph with the replay-safety ruling.
  - In the results client, sign `closeChallengeMessage(wallet, id)` with `signMessage` from `useWallet()` and send it as `signature`. If `signMessage` is undefined, show "This wallet can't sign messages."
- [ ] **Step 4:** Run lint, test, build and root ci. Commit `feat: closing a challenge requires a signed wallet message`.

### Task 4: Separate "Approve in Phantom" from "Confirming on devnet", with cancel

**Files:**
- Create: `apps/app/lib/send-tx.ts`, `apps/app/tests/send-tx.test.mjs`
- Modify: `apps/app/app/join/[code]/join-client.tsx` (`handleDeposit` and the button), `apps/app/app/challenges/new/page.tsx` (`handleSubmit` and the submit button)

**Interfaces:**
- Produces:
  - `type TxPhase = "approve" | "confirm"`
  - `sendWithPhases(connection: Connection, sendTransaction: WalletContextState["sendTransaction"], tx: Transaction, onPhase: (p: TxPhase) => void): Promise<string>`. Only type imports from web3 and wallet-adapter, so the file transpiles with no requires.

- [ ] **Step 1: Write the failing tests** with a fake `connection` (`getLatestBlockhash` resolves `{blockhash:"bh", lastValidBlockHeight:100}`; `confirmTransaction` resolves `{value:{err:null}}`) and a fake `sendTransaction`:
  - `reports approve then confirm and returns the signature`: phases are `["approve","confirm"]`, the result is `"sig"`, and `tx.recentBlockhash === "bh"`.
  - `confirm uses the same blockhash`: `confirmTransaction` received `{signature:"sig", blockhash:"bh", lastValidBlockHeight:100}` and `"confirmed"`.
  - `wallet rejection propagates and never reaches confirm`: `sendTransaction` rejects → the promise rejects, and the phases are `["approve"]`.
  - `on-chain error throws`: `confirmTransaction` gives `{value:{err:{InstructionError:[0,"x"]}}}` → rejects with `/failed on chain/`.
- [ ] **Step 2:** Run `npm test`. Expected: the new file fails.
- [ ] **Step 3:** Implement `sendWithPhases`:
  - call `onPhase("approve")`, get the latest blockhash and set `tx.recentBlockhash`;
  - `await sendTransaction(tx, connection)`;
  - call `onPhase("confirm")`, then `confirmTransaction({signature, blockhash, lastValidBlockHeight}, "confirmed")`;
  - if `value.err` is set, throw `new Error("transaction failed on chain: " + JSON.stringify(err))`;
  - return the signature.
- [ ] **Step 4: Wire up the deposit.** In `join-client.tsx`:
  - Build the transaction with `program.methods.joinTeam(...).accounts(...).transaction()`, set `feePayer = publicKey`, and send it with `sendWithPhases` using `useConnection()` and `useWallet().sendTransaction`.
  - Replace `depositing: boolean` with `phase: TxPhase | null`. Button labels: `"Approve in Phantom…"` / `"Confirming on devnet…"`.
  - While `phase === "approve"`, show a "Cancel" text button and the hint "No Phantom window? Open the Phantom extension." Cancel sets `phase` to null.
  - Ignore late results: keep an attempt counter in a `useRef`, bump it on cancel and on each new attempt, and drop the outcome if the counter changed.
  - Keep the existing `DeadlinePassed` error mapping.
  - Add a one-line comment on the cancel limit (see Rulings).
- [ ] **Step 5: Wire up create** the same way for both transactions (`initializeGroup` when needed, then `initialize`), with the same labels, cancel and attempt guard. `router.push` runs only after the second confirm.
- [ ] **Step 6: Verify.** Run lint, test and build. Then run `next start` and `node tests/ui-smoke.mjs`; expect PASS (it mocks the wallet). Manual, on desktop Phantom: deposit shows "Approve in Phantom…", then "Confirming on devnet…", then "Deposited"; pressing Cancel during approval re-enables the button.
- [ ] **Step 7:** Commit `feat(app): show wallet-approval vs confirmation states; allow cancelling a stuck approval`.

### Task 5: Non-members get a way to join from the scoreboard

**Files:** Modify `apps/app/app/challenges/[id]/client.tsx:282-286`

- [ ] **Step 1:** Replace the non-member branch:
  - wallet connected → `<Link href={`/join/${id}`} className="button-primary">Join a team</Link>`, with the line "You're not on a team in this challenge yet." (the join page already handles deadline and settled);
  - not connected → keep the existing text.
- [ ] **Step 2:** Run lint and build, then the UI smoke test (its wallet is a member, so it should still PASS). Manual: opening an unjoined challenge from "Your challenges" shows "Join a team", which leads to the team picker.
- [ ] **Step 3:** Commit `fix(app): scoreboard links non-members to the join page`.

### Task 6: Honest program and app docs

**Files:** Modify `programs/commitment-stakes/README.md`, `programs/commitment-stakes/docs/recovery.md`, `apps/app/README.md`, `readme.md`, `AGENTS.md`

- [ ] **Step 1:** Rewrite the program `README.md` with this outline only:
  - purpose;
  - program ID `DhWeNpUmpxjSXdZ6iN1VCbP1WJVAYg9Yrprtx1LBPDum` on devnet;
  - the five instructions (`initialize`, `initialize_group`, `join_team`, `settle`, `claim`);
  - settlement math in `src/math.rs` (10 unit tests, run in CI after Task 7);
  - 9 instruction-level tests in `tests/commitment-stakes.ts` (worked example, both-fail, both-pass, double settle, early claim, double claim, wrong oracle, early settle, double join), run with `anchor test` in Linux/WSL2 and **not run in CI**;
  - upgrade authority and oracle are single keys;
  - link to `docs/account-contract.md`.

  Remove "incomplete draft" and the Slack "source specification gate" section.
- [ ] **Step 2:** In `recovery.md`, add a first-line banner: "Historical record of the 14 Nov 2026 recovery. The program has since been completed; see ../README.md." Change nothing else.
- [ ] **Step 3:** Replace `apps/app/README.md` with 3 lines: what `apps/app` is, plus links to `../../readme.md` and `DEPLOYMENT.md`.
- [ ] **Step 4:** In root `readme.md` "Trust model and known limits", add two notes. Workout submissions are checked against challenge membership and the deadline, but not authenticated per caller. Closing a challenge requires a wallet signature. In `AGENTS.md`, "Repository layout": the `.github/workflows/` row becomes "CI: repo guard, `apps/app` lint/test/build, program unit tests".
- [ ] **Step 5:** Run root ci. Commit `docs: current program README, historical banner on recovery log, app README pointer`.

### Task 7: CI runs the program's unit tests

**Files:** Modify `.github/workflows/app.yml`

- [ ] **Step 1:** Add a second job, `program`, on `ubuntu-24.04` with a 20-minute timeout. Steps: the same pinned `actions/checkout`, then `cargo test --locked --manifest-path programs/commitment-stakes/Cargo.toml`. Use the runner's preinstalled stable Rust; no cache action, since there's no pinned SHA for one yet.
- [ ] **Step 2:** This can't run locally (Windows can't build the program). Verification is the CI run in Step 3: the `program` job must pass and its log must list `test result: ok. 10 passed`. If the build fails on the runner's toolchain, record the error and stop. Don't pin a toolchain by guesswork.
- [ ] **Step 3:** Commit `ci: run the settlement math unit tests`. When Stephen approves pushing, push the branch and open PR #2; its CI run is the check for this task.
