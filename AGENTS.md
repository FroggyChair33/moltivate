# Moltivate contributor instructions

## Start here

**If `HANDOFF.md` exists at the repo root, read it before anything else in this file.** It's a mid-session handoff note - current work-in-progress state, exact next steps, secrets/credentials handling, and environment gotchas that took real time to discover. It is not always present (it's written ad hoc when work hands off between agents/sessions, and isn't guaranteed to be committed) - if it's missing, proceed with the rest of this file as normal.

This repository belongs to **Moltivate**, a mobile social fitness competition app. Read [readme.md](readme.md) for product intent and [architecture.md](architecture.md) for the proposed technical design before implementing changes.

The repository contains an implemented static landing/preview site in `apps/web/` and planning documents for the real product. The functional app (wallet, challenges, workouts, scoreboard, settlement), its API, the verification worker, and the Solana program remain unimplemented. Distinguish decisions, proposals, implemented behavior, and verified behavior. Never describe a proposed service, unrun test, or simulated transaction as working production functionality.

**Source of truth for product rules:** the "Commitment Stakes — Team Workout Accountability MVP" doc supersedes any conflicting plan previously described in this file or in readme.md/architecture.md - including the settlement math, the challenge lifecycle, the MVP feature list, and the tech stack below. If anything elsewhere in this repo still describes a different stack or different financial rules, that other reference is stale; this file (now aligned with the MVP doc) wins.

Keep this filename as `AGENTS.md` so compatible coding agents can discover it. Add narrower instructions only when a component needs them; keep project-wide rules here.

## Product direction

- Use **Moltivate** as the product name and `moltivate` as the repository name.
- The product is a **mobile-first web app** - there is no native iOS/Android app. The existing `apps/web/` site is a separate marketing/landing page that introduces the product; it is not where the functional app lives, and is not being replaced by it - the two coexist.
- The chosen hackathon track is **Entertainment**. Lead with social fitness competition and self-improvement.
- Preserve the brand line **“Put your money where your muscles are.”** Supporting copy includes “Are you Moltivated?” and “Stay Moltivated.”
- Keep the experience about showing up, contributing to a team, and keeping commitments. Avoid casino styling, promises of returns, and pressure to increase stakes.
- Use the selected `.club` identity when the exact registered hostname is provided. Do not invent DNS records, domain ownership, or a deployed URL.
- An avatar/evolution system is optional future scope. Do not copy Pokémon characters, names, artwork, or interfaces.

## Technical direction

The existing landing/preview site (`apps/web/`) uses **HTML, CSS, and vanilla JavaScript ES modules** without runtime package dependencies, and stays that way - it is not being migrated to the stack below. `<moltivate-demo>` and `<club-board>` are custom elements with scoped styles.

The functional app is a separate Next.js project. Planned stack for it:

| Component | Chosen approach |
| --- | --- |
| Workout capture (primary) | Chert FaceTime agent - users call the app's number; the agent gives liveness prompts, counts out loud, and coaches |
| Server CV (primary) | Python worker running MediaPipe Pose on the call's frames; reps are counted server-side, never reported by the user's device |
| Workout CV (fallback) | MediaPipe Pose (Tasks Vision, JS) in-browser, no Chert needed; counts marked lower trust |
| Frontend | Next.js (React, TypeScript), mobile-first web app - create/join/scoreboard/results screens plus the fallback session |
| Wallet | Phantom via `@solana/wallet-adapter`; devnet faucet for test SOL |
| Smart contract | Anchor (Rust) program on Solana devnet - escrow, settlement math, payouts |
| Backend / oracle | Next.js API routes + an oracle keypair - receives sessions from both capture paths, signs `settle()` |
| Database | Supabase (Postgres) - users, challenges, workout sessions |
| Hosting | Vercel (web + API); the CV worker runs on Railway or Render, since serverless functions aren't built for long-running video processing |
| Stake token | Devnet SOL for the MVP; USDC on Solana is a later production step |

Keep video processing out of Next.js API route handlers - that's the separate CV worker's job. The capture path (Chert call or in-browser fallback) produces a verified rep count; the backend records it and reports it at settlement; the Solana program controls deposited funds and enforces the financial rules.

Consult the [official Solana quick start](https://solana.com/docs/intro/quick-start) and relevant primary documentation when implementing blockchain features. Recheck current package names and compatibility; do not mix incompatible Solana client generations. Pin compatible dependencies in lockfiles and record the reason for that choice.

Validate the wallet connection and both capture paths on a physical phone, not just desktop browser devtools' mobile emulation - a devtools viewport resize does not establish that camera/FaceTime/wallet-extension behavior actually works on a phone.

## Working on the landing/preview site (apps/web)

This section is only about the existing marketing site, not the functional app (see "Technical direction" above for where that lives: a separate Next.js project, `apps/app/`).

- Edit `apps/web/` as the source of truth. `dist/` is generated; rebuild it rather than editing it directly.
- Use Node.js 24 from `.node-version`. `npm run check` checks syntax; `npm run build` recreates `dist/`; `npm run check:build` validates static references; `npm run preview` serves a local preview. For the full browser suite, use `npm ci --ignore-scripts`, install Playwright Chromium, then `npm run ci`. Runtime secrets are not required. Keep `package-lock.json` committed and do not claim syntax checks alone cover interactions.
- Preserve `.github/workflows/demo.yml` deployment gating: PRs never deploy, Pages is opt-in through `DEMO_DEPLOY_TARGET=github-pages`, and the tested artifact is reused. Never commit Sites credentials or bypass tokens. See [CI/CD](docs/ci-cd.md) before changing delivery or hosting.
- Preserve the self-hosted fonts and their license/source files in `apps/web/assets/fonts/`. Keep the editorial headings, readable interface type, and handwritten accents distinct.
- Keep sample activity and simulated SOL figures visibly labeled. The frontend does not access a camera, wallet, application API, database, or network payout service. Do not suggest otherwise in status messages or documentation.
- Keep App Store availability honest: the current button opens a coming-soon dialog. Do not invent a store listing, waitlist signup, or successful subscription.
- Preserve keyboard navigation, focus states, modal Escape behavior, responsive layouts, and reduced-motion behavior. Verify the phone's playback controls and Club search/filter/sort/detail flows after relevant changes.
- The website's completion bars show fixture workout progress; Club reward totals reflect the selected sample period. Keep that distinction visible rather than implying a current challenge payout.
- A successful `npm run check` establishes syntax only. Report browser interaction checks separately, and do not substitute frontend simulation for native-device or devnet verification.

## Working on the functional app (apps/app)

- The real product - wallet connect, challenge create/join, workout sessions, scoreboard, settlement, claim - lives in `apps/app/`, a Next.js (React, TypeScript) project. It does not share code or deployment with `apps/web/`.
- API routes under `apps/app/` are the backend; there is no separate FastAPI/Python service. The only separate service is the CV worker (MediaPipe on Chert call frames), which the API routes call out to, not the other way around.
- Supabase (Postgres) holds users/challenges/teams/sessions. Keep the schema's settlement-relevant fields (payouts, forfeits, house cut, group pot) in sync with whatever the Anchor program actually records on-chain - the database is a convenience index, never the authority on fund movement.

## Implementation workflow

Keep Anchor source as ordinary tracked files under `programs/commitment-stakes/`.
Disable nested Git initialization when scaffolding. Never stage `.isolated/`,
recovery patches/bundles, build output, validator ledgers, wallets or keypairs.
Review `git diff --cached --summary` for mode 160000 before publishing: a gitlink
can fail Actions checkout before the repository guard can run. `npm run check`
rejects tracked gitlinks and prohibited paths; this is not a secret content scanner.

1. Inspect the current files, repository instructions, and existing conventions before editing. Do not assume the proposed directory layout already exists.
2. Choose the smallest complete increment that advances the core loop: connect, join/deposit, record, verify, score, settle, claim.
3. State reasonable implementation assumptions and proceed with routine reversible work. Ask only when an unresolved product decision materially changes behavior or financial rules.
4. Resolve and version scoring, eligibility, payout, deadline, and refund rules before implementing escrow. Changes must never silently rewrite an already-funded challenge.
5. Keep unrelated work intact. Avoid broad refactors or extra infrastructure without a demonstrated need.
6. Update affected documentation and setup instructions alongside code. Only document commands that exist and have been checked.
7. Report what changed, what was actually tested, and any concrete limitation.

Use conventional component boundaries when scaffolding, as specified in the architecture. Keep API schemas, generated contract types, and scoring rules synchronized. Do not hand-edit generated IDLs as a substitute for changing and rebuilding the program.

## Financial correctness

- Default development and demos to **Solana devnet with test SOL**. Mainnet and real funds require a separately requested, reviewed release.
- Never collect a user's seed phrase or private key. Wallet approvals happen in the wallet.
- Use integer lamports and checked arithmetic throughout. Do not calculate payouts using floating point or JavaScript `Number` beyond its safe range; serialize large integers explicitly.
- Treat an RPC submission response as pending. Verify transaction success and resulting on-chain state before recognizing a deposit, payout, or refund.
- Make deposit and enrollment atomic. Enforce participant/team limits, unique enrollment, fixed rules, and deadlines in the program.
- Verify signer, account ownership, PDA seeds, challenge identity, participant identity, and state on every instruction.
- Reject duplicate settlement, double claims/refunds, unauthorized result submission, and settlement after refund activation. A refund and payout must never both be claimable for the same stake.
- Reconcile uncertain transaction outcomes before rebuilding or resubmitting. Persist signatures and idempotency identifiers.
- Enforce conservation of deposited funds. Specify rounding, ties, empty results, incomplete rosters, and settlement timeouts before coding happy-path payouts.
- Keep the result authority and upgrade authority explicit. Do not call backend-verified results fully trustless or claim that program rules can never change while upgrade authority exists.

## Verification, authentication, and data

- Wallet authentication must verify a signed, expiring, single-use challenge bound to the app, wallet, and session. A supplied wallet address alone is not authentication.
- Enforce authorization server-side for challenges, teams, uploads, results, and administrative actions.
- Treat camera files and client-supplied rep counts, clocks, exercise labels, and scores as untrusted input.
- Issue server-bound workout sessions; enforce deadlines, upload limits, content validation, duplicate detection, and bounded processing/retries.
- Record verifier version, exercise rules, accepted counts, and rejection reasons. Retry processing idempotently; do not credit one session twice.
- Low-confidence footage must not silently count as a completed workout. Explain how to retry within the challenge rules.
- MediaPipe pose estimation is a measurement input, not a medical assessment or proof of identity/liveness. Describe anti-cheat limitations honestly.
- Keep raw video, pose data, authentication tokens, and personal details off-chain. Public transaction receipts should expose only the minimum necessary competition data.
- Keep uploads private, use scoped temporary URLs, and implement a defined deletion policy. Do not log media access tokens or use real user recordings in fixtures without permission.
- Keep backend database credentials, settlement signer material, and service secrets out of the mobile bundle and repository. Add redacted environment examples and appropriate ignore rules when scaffolding.

## UX expectations

Make the next action and current state obvious. Distinguish wallet approval, transaction pending, confirmation, recording, upload, verification, rejection, settlement, and claim states. Preserve progress through backgrounding and interrupted connectivity where possible.

Show the network, stake amount, rules, deadlines, and refund conditions before a deposit. Show each member's contribution so team results are understandable. Respect camera consent and offer a clear denied-permission state. Cap score contribution at the commitment target; avoid incentives for unlimited repetitions or escalating spending.

## Verification expectations

Run checks appropriate to the change and report their actual results. A documentation-only change needs consistency/link review, not an invented application test suite. Once implemented, prioritize:

- **Contract tests:** authority/account validation, enrollment atomicity, deadlines, incomplete-enrollment/settlement-timeout refunds, ties, zero scores, rounding, overflow, conservation of funds, duplicate settlement, and duplicate or conflicting claims.
- **Backend tests:** auth nonce expiry/replay, access control, upload validation, job retries, duplicate session credit, score calculation, cutoff windows, and RPC reconciliation.
- **Device checks:** camera denial, unsupported/poor recordings, upload interruption, wallet rejection, app background/resume, link callback validation, wrong network, and pending transaction recovery.
- **End-to-end demo:** two teams create and fund a challenge, complete accepted workouts, settle, claim, and independently inspect devnet receipts; demonstrate a refund scenario too.

Use mocks for isolated tests, but label them. They do not replace one real devnet integration run and real-device wallet/camera verification before claiming the demo works.
