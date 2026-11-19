# Handoff: make this fork solo-owned (remove Chert and the Vultr VM)

Written 2026-11-17 against `main` at `b58c2bd` of the original repo.
Put this file at the fork's root as `HANDOFF.md`, replacing the old one.
`AGENTS.md` tells agents to read `HANDOFF.md` first, so it will be picked up.

## Goal

This fork is Stephen's own copy of Moltivate, for showing to recruiters.
Remove every feature that depends on infrastructure his teammate owns: the
Chert FaceTime coach and the Vultr VM that runs it. After this, workouts
come only from the in-browser MediaPipe squat counter, which already works.
Also remove the static landing page (`apps/web`) and the tooling that only
serves it. The repo becomes the Next.js app, the Anchor program and the
Supabase migrations.

Keep everything else exactly as it is: wallet, create, join, scoreboard,
settle, claim, rematch, display names, and the Anchor program.

## What the app does today (so you know what not to break)

- `apps/app` is a Next.js app deployed on Vercel. It talks to an Anchor program on Solana devnet (`DhWeNpUmpxjSXdZ6iN1VCbP1WJVAYg9Yrprtx1LBPDum`) and to Supabase.
- **Browser capture path (keep):** `app/components/mediapipe-squat-session.tsx` runs MediaPipe Pose in the browser, counts squats with `lib/pose-squat-counter.ts` (knee angle below 110°, then above 160°), and POSTs the count to `/api/workout-sessions`. It is stored as `trust_level: 'unverified'`, `source: 'browser_mediapipe'`.
- **Settlement (keep):** `/api/oracle/settle` sums each member's accepted sessions from Supabase and signs `settle()` with the oracle key. It already counts `unverified` sessions, so the browser path alone completes the full money loop.
- **Chert/VM path (remove):** a "Start live coach call" button reserves a session on the teammate's VM (`https://worker.staymoltivated.club`) through `/api/live-coach/*`. The VM can send results back to `/api/vision/events`. Those results were never written into `workout_sessions` and never affected settlement, so removing this path changes no money logic.

## Changes in `apps/app`

### Delete these files

| Path | Why it exists |
| --- | --- |
| `app/components/live-coach-call.tsx` | The "Start live coach call" button and the hardcoded Chert phone number |
| `lib/live-coach-client.ts` | Signs outbound requests to the VM |
| `lib/moltivate-signature.ts` | Verifies inbound signed requests from the VM; only `/api/vision/events` imports it |
| `app/api/live-coach/session/route.ts` | Start a VM session |
| `app/api/live-coach/session/[id]/route.ts` | Poll a VM session |
| `app/api/live-coach/session/[id]/end/route.ts` | End a VM session |
| `app/api/vision/events/route.ts` | Receives results from the VM |

Delete the now-empty `app/api/live-coach/` and `app/api/vision/` folders too.
Before deleting, grep for each file's exports to confirm nothing else
imports them. As of `b58c2bd`, only the files in this table and
`app/challenges/[id]/client.tsx` do.

### Edit these files

1. **`app/challenges/[id]/client.tsx`**
   - Remove the `LiveCoachCall` import (line 9).
   - Remove `<LiveCoachCall ... />` (around line 285). The fragment then holds only `<MediaPipeSquatSession ... />`, so drop the `<>…</>` wrapper as well.

2. **`app/api/workout-sessions/route.ts`**
   - Accept only `source === "browser_mediapipe"`. Remove `"chert_facetime"` from the validation.
   - Delete the trusted-caller path: `isTrustedCaller()`, the `TRUSTED_LEVELS` set, and the branch that lets a caller assert `trustLevel` or `livenessResult`. With no server verifier, nothing should be able to write `verified` or `low_trust`. Every row is `unverified`.
   - Rewrite the header comment so it no longer mentions the Chert verifier or `WORKOUT_INGEST_SECRET`.
   - Keep all the other validation (pubkeys, idempotency key, integer reps, deadline and membership checks). That is the trust boundary.

3. **`app/api/oracle/settle/route.ts`** — comment only. Lines 12–20 say counts will be filtered by trust level "once a real verifier exists". Reword: there is no verifier in this version, so settlement counts browser-reported reps. Don't change the logic.

4. **`app/components/mediapipe-squat-session.tsx`** — comment only. Lines 15–19 call this the lower-trust fallback to a Chert primary path. Reword it as the only capture path. The UI is fine as is.

5. **`app/coach/page.tsx`** — this page is a placeholder for the FaceTime coach. It shows a "FaceTime coach" tag, "App connection pending", and "FaceTime calling will open here…".
   - Turn it into a pre-workout page for the browser camera. Keep the existing "pre-workout ritual" sidebar, the `#choose-challenge` anchor, the Polaroid photo and the layout. Replace the FaceTime wording in the left panel with camera-setup guidance: good light, whole body in frame, stand side-on, and video stays on your device.
   - Keep the nav label "Coach" and the route `/coach`. `tests/ui-smoke.mjs` clicks that nav link and expects `**/coach#choose-challenge`. If you rename either, update the test.
   - Also check the "Meet your coach" link and the "In your corner" teaser on `app/page.tsx`. They link to `/coach`, which is fine, but make sure their wording doesn't promise an AI or voice coach.

6. **`DEPLOYMENT.md`**
   - Remove the `WORKOUT_INGEST_SECRET` row and its mentions (around lines 60 and 67).
   - Delete the "Chert/MediaPipe VM integration point" section (around lines 131–160).
   - Drop `chert_facetime` from the documented payload.
   - Remove the opening sentence that points to the teammate's VM.

7. **`PWA_IMPLEMENTATION.md`** — line 4 mentions live-coach branch history. Remove or reword it.

## Changes outside `apps/app`

### Delete (teammate-owned or VM-only)

| Path | What it is |
| --- | --- |
| `services/vision-worker/` | The Python worker that runs on the VM |
| `ops/vultr/` | systemd units and preflight for the VM |
| `docs/live/` | Chert/VM architecture, endpoint contract and deployment runbooks |
| `MOLTIVATE_AI_COACH_BRIEF.md` | Proposal for the VM coach |
| `.github/workflows/vision-worker.yml` | CI for `services/vision-worker` |
| `packages/workout-prep/` and `.github/workflows/workout-prep.yml` | Countdown component for the planned Expo client. `apps/app` doesn't import it; confirm with a grep before deleting |

Also delete the two stray files at the root, `agent-mention-test.txt` and `codex-test.txt`, after checking that they hold nothing meaningful.

### Database

Decided: the fork gets a **brand-new Supabase project** owned by Stephen.
The old project (`fmqorjvuwlobhcchrsav`) stays with the original deployment
and must not be touched or referenced from the fork.

- Delete `supabase/migrations/20261115020000_vision_events.sql`. It creates `vision_event_nonces` and `vision_events`, which only `/api/vision/events` used. Nothing has been applied to the new project yet, so deleting it is safe.
- In the same first schema migration, `workout_sessions.source` allows `'chert_facetime'` (line 107). Because the new project starts empty, edit that check to `source in ('browser_mediapipe')` directly instead of adding a follow-up migration.
- Apply the remaining migrations to the new project in filename order. Stephen creates the project and provides credentials; you don't create accounts.
- Old data does not carry over. Display names and workout history live in the old project, so existing devnet challenges will show no workouts or names in the fork's app. That's expected; use fresh challenges.

### Docs

- **`readme.md`**
  - Delete the "Live coaching handoff" section and every link into `docs/live/`.
  - Delete the "Live coach" row in "The functional app" table, and the status-line sentence about live FaceTime coaching.
  - In "Planned stack (historical)" and "Outside the first MVP", remove the Chert, Vultr and FaceTime items.
  - Remove the `services/vision-worker/` row from the repository guide.
- **`AGENTS.md`**
  - Rewrite the "Latest user direction" block at the top. It sends agents to `docs/live/CODEX_START.md` and describes Vultr/Chert.
  - In the stack table, delete the "Workout capture (primary)" Chert row and the "Server CV (primary)" row. Promote in-browser MediaPipe to the only capture path.
  - Remove the CV-worker hosting note and the sentences about a separate CV worker (around lines 56 and 79).
  - Keep every "Financial correctness" and security rule. They still apply.
- **Old `HANDOFF.md`** is replaced by this file. It's a long Chert-era history, so don't carry it over.

### Remove the landing page (`apps/web`) entirely

Decided: Stephen doesn't want the marketing site in the fork. It's a static
preview with simulated data and none of the app's real functionality. The
teammate owns `staymoltivated.club`, which hosts it, so the fork must not
link to that domain anywhere. `apps/app` is the whole product.

`apps/app` does not depend on it. Its fonts, colours and styles were copied
into `apps/app` earlier; only comments mention `apps/web`. Confirm with a
grep that no import or path reaches into `apps/web` before deleting.

**Delete:**

| Path | Why |
| --- | --- |
| `apps/web/` | The landing page itself, including its photos, sponsor assets, fonts and `IMAGE-SLOTS.md` |
| `scripts/build.mjs`, `scripts/verify-build.mjs`, `scripts/serve.mjs` | Build, link-check and preview the landing page into `dist/` |
| `playwright.config.js` and `tests/e2e/` | Browser tests for the landing page only |
| `.github/workflows/demo.yml` | CI and GitHub Pages delivery for the landing page |
| `docs/ci-cd.md` | Documents that pipeline |
| `docs/motion-design.md` | Scroll-story direction for the landing page |

**Keep, but slim down:**

- `scripts/check-repository.mjs` and `tests/repository.test.js` stay. They block committing gitlinks, keypairs, `.env` files and build output, which matters even more in a public portfolio repo.
  - `tests/repository.test.js` line 27 uses `apps/web/assets/fonts/dm-sans.woff2` as a sample allowed path. It's only a string, but swap it for an `apps/app` path so nothing references the deleted folder.
- `scripts/check.mjs` currently syntax-checks `apps/web` and `playwright.config.js`, then runs the repository guard. Reduce it to the guard only.
- Root `package.json`:
  - Keep only `"check"`, and point `"ci"` at the check plus `node --test tests/repository.test.js`.
  - Remove `build`, `check:build`, `preview` and `test:e2e`.
  - Move the `@playwright/test` dev dependency rather than dropping it. `apps/app/tests/ui-smoke.mjs` imports `@playwright/test`, but `apps/app/package.json` doesn't declare it; it only resolves today because the root `node_modules` has it. Add `"@playwright/test": "1.65.1"` (same pin) to `apps/app` `devDependencies` first, then remove it from the root. Regenerate both lockfiles.
  - Change the `"description"`, which still says "landing page".
- **CI:** replace `demo.yml` with one small workflow, for example `.github/workflows/app.yml`:
  1. the root `npm ci` and `npm run ci`;
  2. then, in `apps/app`, `npm ci`, `npm run lint` and `npm run build`.

  Check whether `next build` needs any env vars at build time. If it does, give CI placeholder public values, never real secrets. Only Stephen can make the workflow a required check in GitHub settings; tell him rather than assuming it.
- **`docs/APP_DESIGN.md`** is about `apps/app`, so keep it. Remove its references to the marketing site only if they read as broken.
- **Comments in `apps/app`** (`app/layout.tsx`, `app/globals.css`, `app/components/eyebrow.tsx`) say "same as the apps/web marketing site". Reword them so they don't point at a folder that no longer exists. Comments only; no style changes.
- **`apps/app/DEPLOYMENT.md`** line 9 lists `apps/web/` in the monorepo layout. Update it.

**Docs:**

- **`readme.md`:**
  - Delete the whole "Landing page (`apps/web`)" section and its "Run locally" commands.
  - Delete the `staymoltivated.club` link and the Demo CI and CI/CD guide links at the top.
  - Remove the `apps/web/` and `scripts/build.mjs` rows from the repository guide.
  - Remove the sentence about "the complete demo source lives in `apps/web/`".
  - Make `https://<new fork Vercel URL>` the main link once it exists.
- **`AGENTS.md`:**
  - Delete the "Working on the landing/preview site (apps/web)" section.
  - Delete the paragraphs in "Product direction" and "Technical direction" saying `apps/web` coexists with the app and stays vanilla JS.
  - Delete the "Preserve `.github/workflows/demo.yml` deployment gating" rule.
  - Keep the brand lines and tone guidance; they apply to the app too.

## Infrastructure Stephen needs to own

For "full control", every item below must belong to Stephen. Confirmed 2026-11-17 unless marked otherwise:

| Thing | Status | Action |
| --- | --- | --- |
| GitHub repo | Original is `betrji/moltivate` (the teammate) | Work only in this fork |
| Vercel project | Decided: the fork gets a **new** Vercel project. The existing `moltivate` project stays with the original repo's code at `moltivate.vercel.app` | From `apps/app`, run `vercel link` and create a new project; don't select `moltivate`. Set Root Directory to `apps/app`. Add the six "Keep" env vars below to Production, using the new Supabase values. Never deploy the fork to the `moltivate` project |
| Solana program | Confirmed: the upgrade authority `P5qbjwm5AptPtWoxyDtwz5Lh6GdyETBpzUkXKSaQAxr` is on Stephen's machine | Keep the same program ID. No redeploy needed, since the Chert removal touches no on-chain code |
| Oracle keypair | `2Cx6Gw…UwS`, secret in Stephen's `apps/app/.env.local` | Keep |
| Supabase | Confirmed: Stephen owns the old project, but the fork gets a **new** one (see "Database") | New project; new `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` |
| Devnet RPC | The old Helius key was rotated and is dead. Production currently uses the public `https://api.devnet.solana.com` | Stephen sets `NEXT_PUBLIC_SOLANA_RPC_URL` to his new Helius **devnet** URL (`devnet.helius-rpc.com`, never `mainnet`). It is public in the browser bundle |
| `staymoltivated.club` | The teammate owns it; it hosts the landing page | Not used by the fork. The landing page is removed, and the fork must not link to this domain |

### Vercel env vars after the change

| Keep | Remove |
| --- | --- |
| `NEXT_PUBLIC_SOLANA_NETWORK`, `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_ORACLE_PUBKEY`, `ORACLE_SECRET_KEY` | `WORKOUT_INGEST_SECRET`, `LIVE_COACH_BASE_URL`, `LIVE_COACH_KEY_ID`, `LIVE_COACH_SECRET`, `LIVE_COACH_EVENT_KEY_ID`, `LIVE_COACH_EVENT_SECRET` |

The new project starts empty, so just never add the "Remove" column. Delete those names from the fork's `apps/app/.env.local` too. Never commit or print any value.

`vercel link` writes `apps/app/.vercel/` (gitignored) and may append a `VERCEL_OIDC_TOKEN` line to `.env.local`. If the fork was copied from a folder already linked to `moltivate`, delete `apps/app/.vercel/` before linking.

## Do not touch

- `programs/commitment-stakes/`. The program has no Chert code; the settlement math stays as it is.
- The settlement math, trust tiers in the database, and payout rules, apart from the API change above.
- `lib/pose-squat-counter.ts` thresholds, unless Stephen asks for that.
- Anything in the original repo (`betrji/moltivate`). All work happens in the fork.

## Verify before calling it done

1. `grep -rniE "chert|live-coach|livecoach|vision/events|vultr|facetime|WORKOUT_INGEST|LIVE_COACH|apps/web|staymoltivated|playwright" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git .` returns nothing outside `apps/app`. Inside `apps/app`, the only allowed `playwright` hits are its own `package.json`, its lockfile and `tests/ui-smoke.mjs`.
2. In `apps/app`: `npm run lint` and `npm run build` are both clean. The route list should no longer contain `/api/live-coach/*` or `/api/vision/events`.
3. At the root: `npm ci`, `npm run ci` and `node --test tests/repository.test.js` all pass. Push a branch and confirm the new CI workflow goes green.
4. Update `apps/app/tests/ui-smoke.mjs` if `/coach` changed, and run it.
5. Do one real devnet loop on the deployed URL: create → join with a second wallet → squat session on camera → wait for the deadline → Settle now → claim on both wallets → open the Explorer links.
6. `POST /api/workout-sessions` with `source: "chert_facetime"` returns 400. A request with an `Authorization` header still stores `unverified`.

## Honest limits to keep in the README (recruiters will ask)

- Reps are counted in the user's browser, so a determined user can fake them. The pose tracking and liveness prompt only deter casual cheating.
- The oracle and the program upgrade authority are single keys. Don't call it trustless.
- There's no timeout refund if settlement never happens.
- Phantom wallet connect does not work on phones yet; desktop works.
- Devnet only.
