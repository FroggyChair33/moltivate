# Moltivate

**Put your money where your muscles are.**

Moltivate is a mobile fitness competition app where friends form teams, put money behind their commitments, and compete through verified workouts. Team accountability makes showing up social; financial stakes give the commitment weight.

**Are you Moltivated?**

[Live demo](https://staymoltivated.club) · [Demo CI](https://github.com/betrji/moltivate/actions/workflows/demo.yml) · [CI/CD guide](docs/ci-cd.md)

The complete demo source lives in `apps/web/`. The demo is public at staymoltivated.club; GitHub Actions produces tested build artifacts, with optional GitHub Pages deployment when a public host is selected.

> Status (15 November 2026): `apps/web/` is the public simulated marketing demo. A separate Next.js app and Anchor program have implementation work; the latest app work is in [PR #16](https://github.com/betrji/moltivate/pull/16). The isolated CPU vision worker is in [draft PR #18](https://github.com/betrji/moltivate/pull/18), and the Expo preparation countdown is in [draft PR #19](https://github.com/betrji/moltivate/pull/19). The intended mobile target is now React Native + Expo. Camera integration, authenticated verification and an end-to-end accepted-workout/settlement flow are not established by these components. Development transactions use Solana devnet test SOL only.

## Current frontend

The website combines a clear landing page with an interactive phone preview and a searchable Club leaderboard. It is built with HTML, CSS, vanilla JavaScript ES modules, and three custom elements: `<moltivate-demo>`, `<club-board>`, and `<rolling-amount>`.

- Centered headline with a copper light sweep and a glossy App Store button. The phone sits below the opening, with three scroll-led chapters spread over three viewport heights on tall desktop screens. The workout chapter gets extra reading space, and chapter ticks show progress. Smaller screens use a direct, optionally looping tour. Selecting a screen or using the phone pauses the scroll story; **Follow scroll** resumes it.
- The phone uses lightweight CSS perspective and a glass reflection, settling flat during interaction. Supporting photo/chat objects reveal once. Motion starts automatically without page-level animation switches. System reduced-motion preferences disable decorative movement; the complete simulated workout and reward flow stays usable.
- Club: a neutral black leaderboard with green gains/red losses, sample teams, search, progress/reward sorting, weekly/monthly filters, and individual crew details. Demo SOL totals update every 4.5 seconds while visible; rolling digits settle on each exact sample value. Updates hold steady while crew details are open, and reduced-motion preferences disable the rolling effect.
- A shared **SOL / USD** switch in the phone, leaderboard, and standings drawer converts sample amounts using Coinbase’s public SOL/USD spot quote. Rates refresh every minute while USD is selected and the page is visible. The price source and retrieval time are shown; unavailable prices keep SOL visible with a retry action. Estimates exclude fees and do not represent real balances.
- Green app icon with a white **m** and orange dot, feature navigation, FAQ content, and a **coming soon** App Store action that opens an availability dialog.
- A pausable sponsor-logo ribbon links to the selected hackathon track ideas: GoDaddy's creative domain, Vultr compute, planned Solana devnet challenges, and Chert video/vision exploration. Sponsor integration and eligibility must be assessed separately from displaying a logo.
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

## How it will work

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
| Product | Mobile app for iPhone and Android |
| Core experience | Social team competition built around exercise |
| Financial infrastructure | Solana; devnet test SOL for the demo |
| Backend hosting | Our own services on Vultr |
| Domain identity | `staymoltivated.club`, purchased through Porkbun; existing public marketing demo |
| Brand lines | “Are you Moltivated?” · “Stay Moltivated.” · “Put your money where your muscles are.” |

Entertainment is the team's chosen submission track. The demo should show an engaging competition, clear team contributions, and a complete workout-to-settlement loop. GoDaddy domain and other sponsor submissions depend on the event's actual rules; no prize eligibility is assumed here.

## Planned native MVP

The table describes the target native experience, not a shipped end-to-end app. Some underlying contract, web-app and worker pieces already exist; see the current implementation status below.

| Area | First version |
| --- | --- |
| Account and wallet | Sign-in, profile, wallet ownership verification, network indicator |
| Challenges | Invite-based teams, explicit rules, fixed start/end times, funded roster |
| Deposits | Per-challenge program-controlled vault; atomic deposit and enrollment |
| Workout capture | Expo camera with configurable local preparation countdown; recording adapter and physical-device testing pending |
| Verification | Isolated MediaPipe candidate-cycle analysis for four exercises; acceptance policy and authenticated integration pending |
| Competition | Personal contribution, team progress, challenge status |
| Settlement | Authorized backend result submission, deterministic payouts, one-time claims |
| Recovery | Incomplete-enrollment and settlement-timeout refunds, upload retries, transaction reconciliation |

### Proposed competition rules

The first rule set should be deliberately small: two equal-size teams, equal deposits, the same completion target, and a cap on score contribution. Extra reps beyond the target should not increase the score.

Financial rules must follow the current Commitment Stakes product specification and Anchor implementation. Older proposals in this README or [architecture.md](architecture.md) must not silently replace the current contract rules. Review and version eligibility, scoring, settlement and refunds before end-to-end integration; freeze a challenge's rules before its first deposit.

### Outside the first MVP

- Mainnet funds, fiat payments, yield products, or a custom token.
- Live video calls, Chert/FaceTime integration, and real-time rep feedback.
- Wearable integrations and public matchmaking. Four exercise types now have experimental worker rules; broad accuracy validation remains pending.
- An evolving creature/avatar system, cosmetics, and advanced progression.
- Claims of clinical benefit, perfect cheating prevention, or fully trustless workout verification.

These can be evaluated after the core loop works. A mascot or evolution mechanic is optional, not a dependency.

## Stack and ownership

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Mobile app | React Native, Expo, TypeScript | Challenge UI, camera, wallet approvals, receipts |
| API | Existing Next.js API work in `apps/app/` | Authentication, authorization, challenges, uploads, progress; do not introduce a duplicate FastAPI backend |
| Video worker | Python 3.12, MediaPipe 0.10.21, FFmpeg | Isolated CPU CLI for experimental candidate cycles; authenticated service adapter pending |
| Data and private media | Supabase PostgreSQL and private object storage | App records, job state, short-lived workout uploads |
| Worker hosting | Existing Vultr CPU VM: 2 vCPUs, 4 GB RAM, Ubuntu 24.04 | Run bounded vision jobs separately from the app/API; no GPU deployment established |
| On-chain program | Rust, Anchor, Solana devnet | Deposits, challenge rules, settlement, claims, refunds |
| Transaction integration | Compatible TypeScript Solana/Anchor clients | Build transactions and submit authorized settlement |

Pin exact package versions after a device integration spike. Android Mobile Wallet Adapter and iOS Phantom links need separate validation. Use development builds and real phones for wallet/camera tests; do not assume Expo Go supports the complete flow.

## Repository guide

| File | Purpose |
| --- | --- |
| [readme.md](readme.md) | Product, scope, stack, and build milestones |
| [architecture.md](architecture.md) | System boundaries, data model, contract rules, failure paths, deployment plan |
| [AGENTS.md](AGENTS.md) | Contributor instructions; read current HANDOFF first for newer user decisions |
| [HANDOFF.md](HANDOFF.md) | Current branches, evidence, ownership, limitations and next integration steps |
| `apps/app/` | Existing Next.js app/API work; coordinate with the app agent before changing |
| `programs/commitment-stakes/` | Anchor program implementation |
| [Vision worker branch](https://github.com/betrji/moltivate/tree/codex/vision-worker-v03/services/vision-worker) | Isolated v0.3.1 worker, setup, diagnostics and integration contract (PR #18) |
| [Workout preparation](packages/workout-prep/README.md) | Isolated Expo countdown and camera integration contract (PR #19) |
| `apps/web/` | Implemented browser frontend, custom elements, styles, and self-hosted assets |
| `scripts/build.mjs` | Dependency-free build that copies the frontend into `dist/` |
| `package.json` | Node requirement and the `check` / `build` commands |

Use each component's own setup instructions and branch. The root scripts build the marketing demo, not an Expo binary or the Python worker. Never commit wallet keypairs, database credentials, or private workout clips.


## Current implementation and testing — 15 November 2026

Read [HANDOFF.md](HANDOFF.md) before resuming. Work remains isolated so the app
agent can integrate it without replacing active app, backend or contract edits.
The newer user decisions are **React Native + Expo for mobile**, **Vultr for the
vision worker**, and an **on-phone preparation countdown**. Older Next.js-only,
Railway/Render and Chert-primary proposals are not evidence of completed native
or live-video integration. Keep existing Next.js work intact during that transition.

### Workout preparation

[PR #19](https://github.com/betrji/moltivate/pull/19) supplies an Expo component:
seven seconds by default, presets of 3/5/7/10/15/30 seconds, and custom whole
seconds from 1–60. It provides visible/spoken cues, Cancel, and interruption
handling. The phone runs the countdown locally; recording begins afterward.
The VM never waits through the countdown or processes preparation footage.

The component still needs the actual camera adapter and physical iOS/Android
tests. Its start promise must acknowledge capture starting, not resolve when
the finished file is returned. Cancellation must stop/discard late captures.
See the [integration contract](packages/workout-prep/README.md). Twelve timer
controller tests and JSX syntax bundling passed locally; the countdown workflow
and Demo CI passed on commit `b6cb26f`. These checks do not verify native capture.

### Vision worker

[PR #18](https://github.com/betrji/moltivate/pull/18) contains
`motion-experiment-0.3.1`: local MP4/MOV decoding, estimated 3D joint angles,
usable-side selection, posture gates, candidate cycles and diagnostic JSON/CSV
with optional skeleton video. Exercise selectors are `squats`, `pushups`,
`situps` and `jumping_jacks`. The reported automated suite had 41 passing tests;
synthetic geometry tests do not establish accuracy across people or camera views.

User-reported Vultr results for the same 15.798-second **squats2** clip:

| Measurement | Result |
| --- | --- |
| Manually confirmed repetitions | 4 |
| Candidate complete cycles | 4; no initial partial or unfinished cycle |
| Usable frames | 158/158 at 10 samples/second |
| Selected side | Right |
| Processing with diagnostic overlay | 10.166 seconds |
| Subsequent run without overlay | 5.754 seconds |
| Event completion times | 6.0, 8.1, 10.1, 11.9 seconds |

The latter run took about 43% less processing time, with matching counts and
event times. These are two user-reported runs, not a controlled performance
study; upload time, queueing and concurrent users are not included. The footage
was not independently inspected in this workspace. Use no overlay for timing
runs, and retain overlays for investigating tracking errors.

The original squat clip exposed neutral-endpoint sensitivity in estimated 3D.
The attempted 1.6–2.2-second reference failed stability: median 150.2 degrees,
spread 13.9 degrees versus a 12-degree limit. Do not loosen thresholds merely
to match a known count. Side/oblique views can work, but arbitrary-angle
reliability is not established; occlusion and poor framing may require a retry.

Every current worker output remains experimental: form, identity, liveness,
exercise identity and payout eligibility are false. Candidate counts must not
be credited as accepted workouts or trigger settlement.

### Runtime and remaining integration

The initial Vultr credit budget is $260; its current remaining balance has not
been rechecked. Keep one bounded job at a time on the existing CPU VM while
measuring accuracy and latency. A faster CPU/GPU or on-device inference is a
future experiment, not a required purchase or an implemented optimization.

The backend owns authorization, membership, deadlines, uploads, job state and
idempotent results. The worker owns video analysis. Chert coaching/caller-frame
access and a LiveKit adapter remain unimplemented and must be verified before
depending on them. Entire is an additional track/handoff direction, not proof
that an agent session was captured or transferred.

Next: test known-count push-ups, sit-ups and jumping jacks plus negative
controls, repeat timing runs, wire the Expo camera/countdown on real phones,
then integrate authenticated uploads and bounded worker jobs. Preserve the
experimental result boundary until an evaluated acceptance path exists.

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
