# Solo-Fork Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fork depend only on things Stephen owns. Remove the Chert/Vultr live-coach path, the `apps/web` landing page and the tooling only they used. Lock `/api/workout-sessions` to `unverified` browser sessions. Leave the repo with an honest README and a CI workflow that lints, builds and tests `apps/app`.

**Architecture:** This is mostly deletion. The only logic change is in `app/api/workout-sessions/route.ts`: the trusted-caller branch goes away and `source` must be `browser_mediapipe`. A new node:test pins that behaviour, using the transpile-and-`vm` pattern already in `tests/challenge-discovery.test.mjs`. The Anchor program and the settlement math are not touched.

**Tech Stack:** Next.js 16.4.6 / React 19.3 (TypeScript), node:test, Playwright 1.65.1 (UI smoke only), GitHub Actions, Supabase Postgres, Vercel.

**Spec:** `HANDOFF.md` (repo root, 2026-11-17). Read it alongside this plan; section names below refer to it.

## Global Constraints

- Do not touch `programs/commitment-stakes/` code, the settlement math, payout rules, or the `lib/pose-squat-counter.ts` thresholds. Program *docs* may be edited (Task 5).
- Every stored workout session is `trust_level: 'unverified'`, `liveness_result: 'not_run'`. Nothing may assert a higher trust level.
- Never print, log or commit any secret value. `.env.example` lists names only.
- The fork must not link to `staymoltivated.club`, `worker.staymoltivated.club`, `docs/live/` or the `moltivate` Vercel project.
- Before you finish each task, run `npm run lint` and `npm run build` in `apps/app`. From Task 3 on, also run `npm run ci` at the root.
- Pin `@playwright/test` at exactly `1.65.1`.
- Do not push or deploy unless Stephen asks. Work on branch `solo-fork-cleanup`.

## Gaps found beyond HANDOFF.md (folded into tasks)

1. `apps/app/.env.example` still lists `WORKOUT_INGEST_SECRET`, all five `LIVE_COACH_*` vars, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No code reads the anon key. Task 1 removes all seven.
2. `architecture.md` (root) describes `apps/web` as the frontend, and `readme.md` links to it four times. `programs/commitment-stakes/docs/chert-capability.md`, the program's `README.md` and `docs/recovery.md`, and `docs/APP_DESIGN.md` all mention Chert/FaceTime. HANDOFF's final grep would fail on these. Task 5 handles them.
3. AGENTS.md says CI lints and builds `apps/app`. It doesn't: `demo.yml` only tests the landing page. Task 4's workflow makes the claim true.
4. `apps/app/tests/challenge-discovery.test.mjs` is never run by any script or CI job, and `apps/app` has no `test` script. It passes once `apps/app/node_modules` is installed, but locally it currently fails with `ERR_MODULE_NOT_FOUND typescript` because nothing is installed. Task 1 adds `"test": "node --test tests/*.test.mjs"` and Task 4 runs it in CI.

**Decision (routine, stated):** `readme.md` is mostly hackathon-era landing-page and "proposed rules" text. Task 5 **rewrites** it to a fixed outline instead of deleting sections one by one. That is less work and leaves nothing stale behind.

**Out of scope, recommended as the next plan:** `/api/workout-sessions` does not check deadlines or membership, despite what HANDOFF says. It accepts reps for any valid pubkey pair at any time, and the idempotency key can be an empty string. AGENTS.md requires both checks. Adding them means reading on-chain state in the route, which deserves its own reviewed plan.

## Review Focus

1. A caller sends `Authorization: Bearer <anything>` with `trustLevel: "verified"`. The row is stored as `unverified` / `not_run`. → Task 1 test `ignores caller-asserted trust`.
2. `reps` is `2.5`, `-1` or `"10"`. → 400, nothing inserted. → Task 1 test `rejects non-integer or negative reps`.
3. The same idempotency key is sent twice. → The second call returns 200 `duplicate` and is not credited twice. → Task 1 test `duplicate idempotency key is not an error`.
4. `next build` in CI with no secrets set. It must succeed, because env is only read at request time. → Task 4 Step 2 runs the build with the `.env.local` hidden.
5. `apps/app/.vercel/` is still linked to the teammate's `moltivate` project, so `vercel --prod` would overwrite their deployment. → Task 6 Step 1 checks `projectName` before any deploy.

---

### Task 0: Branch and commit the already-rewritten guidance

**Files:** `AGENTS.md`, `HANDOFF.md` (already modified in the working tree)

- [ ] **Step 1:** `git switch -c solo-fork-cleanup`
- [ ] **Step 2:** `git diff AGENTS.md`. Confirm it has no "Latest user direction" block, no `docs/live` link, no `apps/web` section and no `demo.yml` rule. Its Chert mentions should appear only as "removed, don't reintroduce".
- [ ] **Step 3:** `git add AGENTS.md HANDOFF.md && git commit -m "docs: solo-fork AGENTS.md and cleanup handoff"`

### Task 1: Remove the live-coach path and lock the workout-sessions API

**Files:**
- Delete: `apps/app/app/components/live-coach-call.tsx`, `apps/app/lib/live-coach-client.ts`, `apps/app/lib/moltivate-signature.ts`, `apps/app/app/api/live-coach/` (whole dir), `apps/app/app/api/vision/` (whole dir), `supabase/migrations/20261115020000_vision_events.sql`
- Modify: `apps/app/app/challenges/[id]/client.tsx:9,284-287`, `apps/app/app/api/workout-sessions/route.ts`, `apps/app/app/api/oracle/settle/route.ts:12-20` (comment only), `apps/app/app/components/mediapipe-squat-session.tsx:14-21` (comment only), `apps/app/.env.example`, `apps/app/package.json`, `supabase/migrations/20261114010000_commitment_stakes_schema.sql:107`
- Create: `apps/app/tests/workout-sessions.test.mjs`

**Interfaces:**
- Produces: `POST /api/workout-sessions` that accepts `{ challengePubkey, teamMemberPubkey, idempotencyKey, reps, source: "browser_mediapipe" }` and ignores `trustLevel`/`livenessResult`/`Authorization`. Responses don't change: 400 `{error}`, 201 `{status:"recorded", id, trustLevel:"unverified"}`, 200 `{status:"duplicate"}`, 500 `{error}`. Also produces the `apps/app` script `"test": "node --test tests/*.test.mjs"`.

- [ ] **Step 1: Write the failing test** `apps/app/tests/workout-sessions.test.mjs`

  Copy the loader from `challenge-discovery.test.mjs`: `ts.transpileModule` on `app/api/workout-sessions/route.ts`, then `vm.runInNewContext` with `Request` and `process` passed in. Stub `require`:
  - `"next/server"` → `{ NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } }`
  - `"@solana/web3.js"` → `{ PublicKey: class { constructor(v) { if (v === "bad") throw new Error("bad"); } } }`
  - `"@/lib/supabase-server"` → `{ getSupabaseServerClient: () => fake }`. `fake.from().insert(row)` pushes `row` onto `inserted[]` and returns `{ select: () => ({ single: async () => nextResult }) }`. `nextResult` defaults to `{ data: { id: "row-1" }, error: null }`.

  Helper: `post(body, headers = {})` builds `new Request("http://x/api/workout-sessions", { method: "POST", headers, body: JSON.stringify(body) })` and calls `POST`. The valid base body is `{ challengePubkey: "c", teamMemberPubkey: "m", idempotencyKey: "k1", reps: 12, source: "browser_mediapipe" }`.

  Tests (reset `inserted` and `nextResult` in `beforeEach`):
  - `rejects chert_facetime source`: `source: "chert_facetime"` → status 400, `inserted.length === 0`.
  - `ignores caller-asserted trust`: `process.env.WORKOUT_INGEST_SECRET = "s"`, then post with `{ authorization: "Bearer s" }` and body `trustLevel: "verified", livenessResult: "pass"`. Expect status 201 and `body.trustLevel === "unverified"`. Expect `inserted[0]` to include `trust_level: "unverified"`, `liveness_result: "not_run"`, `source: "browser_mediapipe"`, `status: "accepted"`, `reps: 12`. Delete the env var after.
  - `rejects non-integer or negative reps`: for each of `2.5`, `-1`, `"10"` → status 400, nothing inserted.
  - `rejects invalid pubkeys`: `challengePubkey: "bad"` → 400.
  - `duplicate idempotency key is not an error`: `nextResult = { data: null, error: { code: "23505", message: "dup" } }` → status 200, `body.status === "duplicate"`.

- [ ] **Step 2:** Add `"test": "node --test tests/*.test.mjs"` to `apps/app/package.json` scripts. Run `npm install` in `apps/app` if `node_modules` is missing, then `npm test`. Expected: `ignores caller-asserted trust` FAILS (the stored trust is `verified`) and `rejects chert_facetime source` FAILS (201). `challenge-discovery` passes.

- [ ] **Step 3: Edit `route.ts`.** Delete `TRUSTED_LEVELS`, `LIVENESS_RESULTS`, `isTrustedCaller()` and the `trusted` branch. The validation becomes `body.source !== "browser_mediapipe"`. Insert the literals `trust_level: "unverified"`, `liveness_result: "not_run"`, and return `trustLevel: "unverified"`. Replace the header comment with 3–5 lines. It should say the only caller is the in-browser MediaPipe counter, that every row is `unverified` because no server verifier exists, and that settlement counts these rows (see the oracle route). Keep the pubkey check, the 23505 handling and the outer try/catch exactly as they are.

- [ ] **Step 4:** `npm test` in `apps/app`. Expected: all tests pass.

- [ ] **Step 5: Remove the UI and the routes.** In `client.tsx`, delete the `LiveCoachCall` import and element, and unwrap the `<>…</>` so only `<MediaPipeSquatSession … />` remains. Delete the files and directories listed above. Then run `grep -rnE "live-coach|LiveCoach|moltivate-signature|vision/events" apps/app --exclude-dir=node_modules --exclude-dir=.next`. Expected: no hits.

- [ ] **Step 6: Comments and env.** Reword `oracle/settle/route.ts` lines 12–20: there is no verifier in this version, so settlement counts browser-reported `unverified` reps 1:1, and that is a known gap. Reword `mediapipe-squat-session.tsx` lines 14–21 to call it the only capture path, and drop "fallback" and "Chert". Leave the `shortcut:` CDN note. In `.env.example`, remove the `WORKOUT_INGEST_SECRET` block, both `LIVE_COACH_*` blocks and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Exactly the six AGENTS.md variables remain.

- [ ] **Step 7: Migrations.** Delete `20261115020000_vision_events.sql`. In the schema migration, line 107 becomes `source text not null check (source in ('browser_mediapipe')),`. Editing in place is safe only because the new Supabase project is empty (HANDOFF "Database"); say so in the commit message.

- [ ] **Step 8: Verify.** In `apps/app`, run `npm run lint && npm test && npm run build`. Expected: clean, and the build's route list has no `/api/live-coach` and no `/api/vision`.

- [ ] **Step 9: Commit.** Message: `feat(app): remove Chert live-coach path; workout sessions are always unverified`. Add a body line: "Schema migration edited in place; fork uses a fresh, empty Supabase project."

### Task 2: Coach page becomes browser-camera prep

**Files:** Modify `apps/app/app/coach/page.tsx` (left `coach-room` section only) and `apps/app/app/page.tsx:13,20` (copy only).

- [ ] **Step 1:** In `coach/page.tsx`, change the `coach-room` copy. Keep the layout, class names, `CoachMark`, the sidebar, the Polaroid, `#choose-challenge` and the heading block.
  - Tag: "Camera setup".
  - State: "Runs in your browser".
  - Portrait `<p>`: "Space to move. A phone or laptop camera. You."
  - Bubble: "Good light, whole body in frame, stand side-on. We'll count one rep at a time."
  - Bubble `<span>`: "Video stays on your device. Only the count is sent."
  - Footer `<p>`: "Open a challenge you've joined to start the camera."
  - Page intro: "A little encouragement to keep showing up." (drop "A friendly voice", which implies a voice coach).
- [ ] **Step 2:** In `page.tsx`, change "Meet your AI workout coach and get ready for your next set." to "Set up your camera and get ready for your next set." Keep "Meet your coach ↗" and the `/coach` links.
- [ ] **Step 3:** Run `grep -rniE "facetime|AI (voice|workout coach)" apps/app/app`. Expected: no hits. Then, in `apps/app`, run `npm run lint && npm run build`. Start `npm run start -- -p 13000` and run `node tests/ui-smoke.mjs`. Expected: it passes, including the nav click to `**/coach#choose-challenge`. Stop the server.
- [ ] **Step 4:** Commit: `feat(app): coach page is browser-camera setup, not a FaceTime placeholder`.

### Task 3: Delete teammate-owned and VM-only material

**Files:** Delete `services/vision-worker/`, `ops/vultr/`, `docs/live/`, `MOLTIVATE_AI_COACH_BRIEF.md`, `.github/workflows/vision-worker.yml`, `packages/workout-prep/`, `.github/workflows/workout-prep.yml`, `agent-mention-test.txt` ("this agent was called"), `codex-test.txt` ("hello from codex").

- [ ] **Step 1:** Run `grep -rn "workout-prep\|WorkoutPrep" apps programs supabase scripts tests package.json --exclude-dir=node_modules`. Expected: no hits. If anything appears, stop and report it.
- [ ] **Step 2:** `git rm -r` every path above.
- [ ] **Step 3:** At the root, run `npm run check`. Expected: it passes (it doesn't scan the deleted dirs).
- [ ] **Step 4:** Commit: `chore: remove teammate-owned VM worker, Vultr ops, live docs and Expo prep package`.

### Task 4: Remove `apps/app`'s landing-page sibling and replace CI

**Files:**
- Delete: `apps/web/`, `scripts/build.mjs`, `scripts/verify-build.mjs`, `scripts/serve.mjs`, `playwright.config.js`, `tests/e2e/`, `.github/workflows/demo.yml`, `docs/ci-cd.md`, `docs/motion-design.md`
- Modify: `scripts/check.mjs`, `tests/repository.test.js:27`, root `package.json`, `apps/app/package.json`, both `package-lock.json`s
- Create: `.github/workflows/app.yml`

**Interfaces:** Produces the root `npm run ci` = `npm run check && node --test tests/repository.test.js`, and `apps/app` `devDependencies["@playwright/test"] = "1.65.1"`.

- [ ] **Step 1:** Run `grep -rn "apps/web" apps/app --include=*.ts --include=*.tsx --include=*.mjs --include=*.json --exclude-dir=node_modules`. Expected: no hits (comments in `.css`/`.tsx` comment lines are handled in Task 5). Add `"@playwright/test": "1.65.1"` to `apps/app` devDependencies, then run `npm install` in `apps/app`.
- [ ] **Step 2:** Prove the build needs no secrets. In `apps/app`, temporarily rename `.env.local`, run `npm run build`, then restore it. Expected: build succeeds. If it fails, add only placeholder `NEXT_PUBLIC_*` values to the workflow's `env:`, never real ones.
- [ ] **Step 3:** Delete the files above. `scripts/check.mjs` shrinks to the imports needed plus `checkRepository(root)` and a one-line success log. `tests/repository.test.js:27`: replace `'apps/web/assets/fonts/dm-sans.woff2'` with `'apps/app/public/photos/gym-team.jpg'`. In the root `package.json`, set `"description": "Moltivate: team workout accountability on Solana devnet"`, keep the scripts to `check` and `ci` only, remove `devDependencies`, then run `npm install` at the root to regenerate the lockfile.
- [ ] **Step 4:** Create `.github/workflows/app.yml`. Name it `App CI`, with triggers, `permissions`, `concurrency`, and the pinned `actions/checkout` / `actions/setup-node` SHAs copied from the deleted `demo.yml` (with `node-version-file: .node-version` and `persist-credentials: false`). It has one job on `ubuntu-24.04` with steps: root `npm ci --ignore-scripts` → `npm run ci`, then with `working-directory: apps/app`: `npm ci` → `npm run lint` → `npm test` → `npm run build`. Set `cache-dependency-path` to both lockfiles. Do not run the Playwright smoke in CI (it needs a browser install and a running server; that's a later decision).
- [ ] **Step 5: Verify.** At the root, run `npm ci && npm run ci`. Expected: guard passes, repository tests pass. In `apps/app`, run `npm ci && npm run lint && npm test && npm run build`. Expected: all clean. Then run `git diff --cached --summary | grep 160000`. Expected: no output.
- [ ] **Step 6:** Commit: `chore: drop apps/web landing page; CI now lints, tests and builds apps/app`.

### Task 5: Documentation tells the truth

**Files:** Rewrite `readme.md`. Delete `architecture.md` and `programs/commitment-stakes/docs/chert-capability.md`. Modify `apps/app/DEPLOYMENT.md`, `apps/app/PWA_IMPLEMENTATION.md:4`, `docs/APP_DESIGN.md:14,40,46,68`, `programs/commitment-stakes/README.md:6,23,77`, `programs/commitment-stakes/docs/recovery.md:26,52`, plus comments in `apps/app/app/layout.tsx:7`, `apps/app/app/globals.css:3,13,72` and `apps/app/app/components/eyebrow.tsx:1`.

- [ ] **Step 1: `readme.md` rewrite**, using this outline and nothing else:
  1. Title, the brand line, and a one-paragraph pitch. Add a "Live app" link placeholder `https://<fork Vercel URL>` marked TODO until Task 6.
  2. **How it works**: the loop connect → join/deposit → record → score → settle → claim.
  3. **Settlement rules**, copied from AGENTS.md "Settlement rules", stating they are enforced in `programs/commitment-stakes/src/math.rs`.
  4. **Stack**: the AGENTS.md table.
  5. **Repository guide**: the AGENTS.md layout table.
  6. **Run locally**: `cd apps/app && npm ci && cp .env.example .env.local && npm run dev`, with test commands `npm run lint`, `npm test`, and root `npm run ci`. List only commands that were run in Tasks 1–4.
  7. **Trust model and known limits**: the five HANDOFF "Honest limits" bullets, plus the AGENTS.md "Known gaps" bullets.
  8. **Credits**: "Forked from a team Emory Hacks (Nov 2026) project." Don't link to teammate infrastructure.
- [ ] **Step 2:** `DEPLOYMENT.md`: remove line 9's `apps/web/`, the `WORKOUT_INGEST_SECRET` row and its mentions, the "Chert/MediaPipe VM integration point" section, `chert_facetime` in the payload, and the opening VM sentence. Add one line warning never to link `apps/app` to the `moltivate` Vercel project. `PWA_IMPLEMENTATION.md:4`: delete the live-coach branch sentence.
- [ ] **Step 3:** `APP_DESIGN.md`: change the FaceTime lines to "the browser camera is the only capture path", and delete the marketing-demo sentence on line 68. Program `README.md`: delete line 23 (the Slack/Chert search), the line-77 link, and the `apps/web` clause on line 6. `recovery.md`: drop "historical Chert report" from line 26 and the Chert sentence on line 52. Delete `chert-capability.md` and `architecture.md`.
- [ ] **Step 4:** In the three `apps/app` source comments, reword "same as the apps/web marketing site" to describe the palette/fonts/pattern directly. Comments only, with no CSS or markup change.
- [ ] **Step 5: Final grep (HANDOFF "Verify" #1):** `grep -rniE "chert|live-coach|livecoach|vision/events|vultr|facetime|WORKOUT_INGEST|LIVE_COACH|apps/web|staymoltivated|playwright" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git . | grep -vE "^\./(AGENTS|HANDOFF)\.md|^\./docs/superpowers/"`. Expected: the only `playwright` hits are in `apps/app/package.json`, `apps/app/package-lock.json` and `apps/app/tests/ui-smoke.mjs`. There are no other hits. AGENTS.md is allowed its "removed, don't reintroduce" mentions.
- [ ] **Step 6:** In `apps/app`, run `npm run lint && npm run build`, then root `npm run ci`. Expected: clean. Commit: `docs: rewrite README for the solo fork; drop Chert, VM and landing-page references`.

### Task 6: Stephen's infrastructure and the real devnet loop (needs Stephen at each step)

These steps need accounts and wallets only Stephen holds. The executor prepares each command, and Stephen runs or approves it.

- [ ] **Step 1: Vercel safety check.** If `apps/app/.vercel/project.json` exists and its `projectName` is `moltivate`, delete `apps/app/.vercel/`. Stephen runs `vercel link` in `apps/app`, chooses to **create a new project** and sets Root Directory to `apps/app`. Re-check that `projectName` ≠ `moltivate`.
- [ ] **Step 2: Supabase.** Stephen creates a new project. Apply the three remaining migrations in filename order (SQL editor or `supabase db push`). Verify with `select conname, pg_get_constraintdef(oid) from pg_constraint where conname like '%source%';`. It should show only `browser_mediapipe`.
- [ ] **Step 3: Env.** Stephen adds the six variables to Vercel Production. The values are the new Supabase URL and service key, and a Helius `devnet.helius-rpc.com` URL. In `apps/app/.env.local`, remove the six obsolete names and update the Supabase and RPC values. Don't print any value; check names only with `cut -d= -f1 .env.local`.
- [ ] **Step 4: Deploy** with `vercel --prod` from `apps/app`, only when Stephen says so. Fill in the README URL placeholder and commit.
- [ ] **Step 5: HANDOFF Verify #6, against the deployed URL.**
  - `curl -s -X POST <url>/api/workout-sessions -H 'content-type: application/json' -d '{"challengePubkey":"11111111111111111111111111111111","teamMemberPubkey":"11111111111111111111111111111111","idempotencyKey":"probe-1","reps":1,"source":"chert_facetime"}'` → 400.
  - The same request with `browser_mediapipe`, `trustLevel:"verified"` and `-H 'authorization: Bearer x'` → 201 with `"trustLevel":"unverified"`.
  - Delete that probe row in Supabase afterwards.
- [ ] **Step 6: End to end.** Use two wallets on the deployed URL: create → join both teams → camera squats → wait out the deadline → Settle now → claim on both → open the Explorer receipts. Also check camera and layout on a real phone (wallet connect is a known gap there). Record the results in HANDOFF.md, or delete HANDOFF.md if nothing is left to hand off.
