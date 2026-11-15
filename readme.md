# Moltivate

**Put your money where your muscles are.**

Moltivate is a mobile fitness competition app where friends form teams, put money behind their commitments, and compete through verified workouts. Team accountability makes showing up social; financial stakes give the commitment weight.

**Are you Moltivated?**

[Live app (devnet)](https://moltivate.vercel.app) · [Landing page](https://staymoltivated.club) · [Demo CI](https://github.com/betrji/moltivate/actions/workflows/demo.yml) · [CI/CD guide](docs/ci-cd.md)

The complete demo source lives in `apps/web/`. The demo is public at staymoltivated.club; GitHub Actions produces tested build artifacts, with optional GitHub Pages deployment when a public host is selected.

> Status (2026-11-15): the functional app (`apps/app`) is deployed at [moltivate.vercel.app](https://moltivate.vercel.app) against an Anchor program on Solana devnet. The create → join → camera workout → settle → claim loop was run end to end on devnet from a local build; the deployed build has been checked for page loads and its database connection only. Live FaceTime coaching through Chert is wired to a button but not verified end to end, and its counts never feed settlement. Devnet/test SOL only. Sections below marked "planned" predate the app and are kept for history; where they disagree with this block or with [AGENTS.md](AGENTS.md), they are stale.

## The functional app (`apps/app`)

Two teams each stake devnet SOL on a shared rep goal. The program escrows the stakes; after the deadline an oracle reports each member's count, the program computes every payout, and members claim.

| Piece | What exists |
| --- | --- |
| Frontend + API | Next.js (TypeScript) on Vercel: create, join by invite link, scoreboard, results, claim, rematch |
| Wallet | Phantom via `@solana/wallet-adapter`, desktop browsers; phone wallet connect is not working yet |
| Workout capture | In-browser MediaPipe pose tracking counts squats from the knee angle, with a liveness prompt. Recorded as `unverified` |
| On-chain program | Anchor (Rust), devnet, `DhWeNpUmpxjSXdZ6iN1VCbP1WJVAYg9Yrprtx1LBPDum`: `initialize`, `initialize_group`, `join_team`, `settle`, `claim` |
| Oracle | A server-side keypair in `/api/oracle/settle` sums accepted sessions from Supabase and signs `settle()` |
| Database | Supabase (Postgres): display names, workout sessions, vision events. An index only; the program is the authority on funds |
| Live coach | Python worker on a Vultr VM (`services/vision-worker`) behind Chert's FaceTime bridge. Experimental, never payout-eligible |

Settlement rules, enforced on chain in integer lamports (`programs/commitment-stakes/.../math.rs`):

- A team passes when its members' combined reps reach `members × goal`. One member's contribution is capped at 150% of their own goal.
- One team passes: each losing member forfeits `stake × (20% + 80% × their shortfall)`. The house takes 3% of everything staked (never more than the forfeits). Winners get their stake back plus the rest, split by reps contributed.
- Both fail: everyone forfeits by the same formula; after the house cut the remainder goes to the group's persistent pot.
- Both pass: everyone gets their stake back plus an equal share of a bonus from the pot, at most 5% of the round's stakes.

Known limits: settlement currently counts `unverified` browser sessions, so results are self-reported in the cheating sense; the oracle and the program upgrade authority are single keys the team holds; there is no refund path if the oracle never settles.

Run it: `cd apps/app && npm ci && npm run dev`, with the variables listed in [apps/app/DEPLOYMENT.md](apps/app/DEPLOYMENT.md) in `apps/app/.env.local`.

## Live coaching handoff

The planned split is **Vercel for the general/Web3 backend**, **Vultr for the long-running MediaPipe/voice agent**, and **Chert's managed FaceTime bridge connected through LiveKit**. Expo is the intended native client; keep the existing Next.js app intact while that client develops.

- [Start here / Codex prompt and checkpoints](docs/live/CODEX_START.md)
- [Live architecture and countdown ownership](docs/live/ARCHITECTURE.md)
- [Proposed endpoint contract](docs/live/ENDPOINT_CONTRACT.md)
- [Vultr deployment runbook and remaining prerequisites](docs/live/VULTR_DEPLOYMENT.md)
- [Worker README](services/vision-worker/README.md) and [Expo countdown](packages/workout-prep/README.md)

The file worker supports squat, pushup, situp and jumping-jack experiments. Flexible pushup tops use 145 degrees; tracking/posture checks remain. Candidate cycles are not verified form, identity, liveness or payout evidence. Live deployment is pending implementation and authenticated local SSH execution.


## Landing page (`apps/web`)

The website combines a clear landing page with an interactive phone preview and a searchable Club leaderboard. It is built with HTML, CSS, vanilla JavaScript ES modules, and three custom elements: `<moltivate-demo>`, `<club-board>`, and `<rolling-amount>`.

- Centered headline with a copper light sweep and a glossy App Store button. The phone sits below the opening, with three scroll-led chapters spread over three viewport heights on tall desktop screens. The workout chapter gets extra reading space, and chapter ticks show progress. Smaller screens use a direct, optionally looping tour. Selecting a screen or using the phone pauses the scroll story; **Follow scroll** resumes it.
- The phone uses lightweight CSS perspective and a glass reflection, settling flat during interaction. Supporting photo/chat objects reveal once. Motion starts automatically without page-level animation switches. System reduced-motion preferences disable decorative movement; the complete simulated workout and reward flow stays usable.
- Club: a neutral black leaderboard with green gains/red losses, sample teams, search, progress/reward sorting, weekly/monthly filters, and individual crew details. Demo SOL totals update every 4.5 seconds while visible; rolling digits settle on each exact sample value. Updates hold steady while crew details are open, and reduced-motion preferences disable the rolling effect.
- A shared **SOL / USD** switch in the phone, leaderboard, and standings drawer converts sample amounts using Coinbase’s public SOL/USD spot quote. Rates refresh every minute while USD is selected and the page is visible. The price source and retrieval time are shown; unavailable prices keep SOL visible with a retry action. Estimates exclude fees and do not represent real balances.
- Green app icon with a white **m** and orange dot, feature navigation, FAQ content, and a **coming soon** App Store action that opens an availability dialog.
- A pausable sponsor-logo ribbon links to the selected hackathon track ideas: GoDaddy's creative domain, planned Vultr deployment, planned Solana devnet challenges, and Chert video/vision exploration.
- A peek-out leaderboard at the top shows teams and rolling weekly demo SOL immediately. It folds toward the edge and fades as the phone enters, reversing when scrolling up. It opens a keyboard-accessible standings drawer and shares one feed with the Club section.
- A retro teammate-chat illustration, a user-supplied Teletubbies gym Polaroid, and the **molt + motivate** origin story. Numbered image slots make personal photos easy to substitute; see [the image-slot guide](apps/web/IMAGE-SLOTS.md).
- Self-hosted Fraunces, DM Sans, and La Belle Aurore fonts; font sources and licenses are included with the assets.

The preview makes no wallet requests, camera requests, application API calls, or payments. Its SOL figures are illustrative display data, **not devnet balances or real payouts**. It does not create accounts, save workout results, or register visitors for a waitlist.

The sponsor marks describe the team's selected hackathon tracks, not customers, endorsements, or completed integrations. Chert supplies messaging/video infrastructure; its potential vision role is exploratory and does not replace the separate workout-verification plan. [Brand asset sources](apps/web/assets/sponsors/ASSET-SOURCES.md) and [photography sources](apps/web/assets/photos/ASSET-SOURCES.md) are recorded alongside the assets.

### Run locally

Requirements: **Node.js 24** (exact CI version in `.node-version`). The site has no runtime package dependencies. Playwright is a pinned development dependency for automated browser testing.

```sh
npm run check
npm run build
npm run check:build
npm run preview
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). For the full CI suite:

```sh
npm ci --ignore-scripts
npx --no-install playwright install --with-deps chromium
npm run ci
```

Every pull request and push to `main` runs the same checks in GitHub Actions. Successful builds are available as downloadable artifacts; failed browser tests include reports/traces. Public deployment is deliberately disabled until `DEMO_DEPLOY_TARGET=github-pages` and Pages settings are configured. See [CI/CD](docs/ci-cd.md) for setup, required checks, and rollback. GitHub pushes do not automatically republish the existing public Site.

`npm run check` checks JavaScript syntax; `npm run check:build` validates assets, imports, anchors, and build boundaries; Playwright tests the actual browser interactions. `npm run build` recreates `dist/` from `apps/web/`. Edit source files, rebuild, and refresh the preview.

No environment variables, API keys, or wallet credentials are needed for this frontend. See [architecture.md](architecture.md) for the boundary between this browser preview and the planned native product.

## The idea

Knowing you should work out is easy. Following through consistently is harder. Moltivate turns a private intention into a shared challenge: your teammates expect you to show up, your progress contributes to a visible result, and your commitment has a stake attached to it.

The brand centers on self-improvement, consistency, and belonging. Competition is the experience; becoming more consistent is the benefit. The name combines **molt**, shedding an old form, with **motivate**.

## How it works

1. **Join your crew.** Create or join a private challenge with friends.
2. **Make a commitment.** Review the workout target, team roster, deadlines, deposit, scoring, payout, and refund rules before joining.
3. **Lock in your stake.** Approve a wallet transaction. Enrollment becomes funded only after the deposit is confirmed on Solana.
4. **Show up.** Record a supported exercise inside the app and upload the set for verification.
5. **See your contribution.** Track accepted workouts, your team's progress, and the remaining time.
6. **Settle the challenge.** After the verification window closes, the backend submits results and the Solana program calculates claimable amounts under the agreed rules.
7. **Claim the result.** Claim a payout or refund and inspect the transaction receipt.

“Verified” means accepted by Moltivate's verification service. Pose tracking and a blockchain receipt do not independently prove that a person exercised honestly.

## Hackathon direction

| Decision | Direction |
| --- | --- |
| Project and repository | **Moltivate** / `moltivate` |
| Emory Hacks track | **Entertainment** |
| Product | Mobile-first web app; a native client is later scope |
| Core experience | Social team competition built around exercise |
| Financial infrastructure | Solana; devnet test SOL for the demo |
| Backend hosting | Vercel for the app and API; a Vultr VM for the live-coach worker |
| Domain identity | The selected `.club` direction; record the exact purchased hostname before configuring DNS and app links |
| Brand lines | “Are you Moltivated?” · “Stay Moltivated.” · “Put your money where your muscles are.” |

Entertainment is the team's chosen submission track. The demo should show an engaging competition, clear team contributions, and a complete workout-to-settlement loop. GoDaddy domain and other sponsor submissions depend on the event's actual rules; no prize eligibility is assumed here.

## Planned native MVP (historical)

All items below are planned, not shipped.

| Area | First version |
| --- | --- |
| Account and wallet | Sign-in, profile, wallet ownership verification, network indicator |
| Challenges | Invite-based teams, explicit rules, fixed start/end times, funded roster |
| Deposits | Per-challenge program-controlled vault; atomic deposit and enrollment |
| Workout capture | In-app camera recording of one supported exercise selected during the verification spike |
| Verification | Asynchronous MediaPipe processing, accepted rep count, confidence/quality checks, clear failure reason |
| Competition | Personal contribution, team progress, challenge status |
| Settlement | Authorized backend result submission, deterministic payouts, one-time claims |
| Recovery | Incomplete-enrollment and settlement-timeout refunds, upload retries, transaction reconciliation |

### Proposed competition rules

The first rule set should be deliberately small: two equal-size teams, equal deposits, the same completion target, and a cap on score contribution. Extra reps beyond the target should not increase the score.

The proposed baseline in [architecture.md](architecture.md) rewards meeting commitments, prevents non-completing teammates from receiving a winner bonus, and defines ties and refunds. **These are implementation proposals, not a finalized financial policy.** Select and version the final rules before implementing escrow; freeze them for a challenge before its first deposit.

### Outside the first MVP

- Mainnet funds, fiat payments, yield products, or a custom token.
- Live video calls, Chert/FaceTime integration, and real-time rep feedback.
- Multiple exercise types, wearable integrations, and public matchmaking.
- An evolving creature/avatar system, cosmetics, and advanced progression.
- Claims of clinical benefit, perfect cheating prevention, or fully trustless workout verification.

These can be evaluated after the core loop works. A mascot or evolution mechanic is optional, not a dependency.

## Planned stack (historical — see "The functional app" for what was built)

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Mobile app | React Native, Expo, TypeScript | Challenge UI, camera, wallet approvals, receipts |
| API | Python, FastAPI | Authentication, authorization, challenges, uploads, progress |
| Video worker | Python, MediaPipe | Background pose analysis and rep verification |
| Data and private media | Supabase PostgreSQL and private object storage | App records, job state, short-lived workout uploads |
| Hosting | Vultr CPU VM, Docker | Run our API, worker, and settlement service |
| On-chain program | Rust, Anchor, Solana devnet | Deposits, challenge rules, settlement, claims, refunds |
| Transaction integration | Compatible TypeScript Solana/Anchor clients | Build transactions and submit authorized settlement |

Pin exact package versions after a device integration spike. Android Mobile Wallet Adapter and iOS Phantom links need separate validation. Use development builds and real phones for wallet/camera tests; do not assume Expo Go supports the complete flow.

## Repository guide

| File | Purpose |
| --- | --- |
| [readme.md](readme.md) | Product, scope, stack, and build milestones |
| [architecture.md](architecture.md) | System boundaries, data model, contract rules, failure paths, deployment plan |
| [AGENTS.md](AGENTS.md) | Instructions and quality expectations for coding agents and contributors |
| `apps/web/` | Landing page: custom elements, styles, and self-hosted assets |
| `apps/app/` | The functional Next.js app and its API routes |
| `programs/commitment-stakes/` | Anchor program: escrow, settlement math, claims |
| `services/vision-worker/` | Python MediaPipe worker and live-coach control API (Vultr) |
| `supabase/migrations/` | Database schema |
| `scripts/build.mjs` | Dependency-free build that copies the frontend into `dist/` |
| `package.json` | Node requirement and the `check` / `build` commands |

Native-app and backend setup commands will be added alongside their implementations, including prerequisites, environment templates, migrations, and local development commands. Never commit wallet keypairs, database credentials, or private workout clips.

## Native product build milestones

1. **Integration spike:** test camera capture/upload and wallet signing on real iPhone and Android devices; select one exercise and compatible dependency versions.
2. **Vertical slice:** create a challenge, join with a confirmed devnet deposit, record a set, and display its verification result.
3. **Competition:** aggregate accepted contributions, close the verification window, and freeze the result snapshot.
4. **Settlement:** submit results, settle once, claim once, and demonstrate a timeout refund.
5. **Demo polish:** handle rejected signatures, poor recordings, retries, empty states, and network interruptions without ambiguous money or score states.

The MVP is ready to demonstrate when two teams can complete that loop and the deposited amount equals all claimable payouts/refunds, with every on-chain action inspectable in a devnet receipt.

## References

- [Solana quick start](https://solana.com/docs/intro/quick-start) — primary starting point for the blockchain integration.
- [Anchor TypeScript client](https://www.anchor-lang.com/docs/clients/typescript) — check compatibility before selecting packages.
- [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/) — mobile recording.
- [Emory Hacks](https://emoryhacks.com/) — event details and track information.
- [Repple](https://www.reppleapp.com/) — inspiration for social fitness competition; Moltivate's implementation and brand are independent.

See [architecture.md](architecture.md) for the detailed technical references and unresolved decisions.
