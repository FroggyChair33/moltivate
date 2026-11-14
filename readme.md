# Moltivate

**Put your money where your muscles are.**

Moltivate is a mobile fitness competition app where friends form teams, put money behind their commitments, and compete through verified workouts. Team accountability makes showing up social; financial stakes give the commitment weight.

**Are you Moltivated?**

> Status: an interactive browser frontend is implemented in `apps/web/`. It introduces Moltivate and previews the planned mobile experience with sample data. The native mobile app, backend, verification worker, and smart contract have not been implemented or deployed. A future end-to-end blockchain demo will use Solana devnet and test SOL only.

## Current frontend

The website combines a clear landing page with an interactive phone preview and a searchable Club leaderboard. It is built with HTML, CSS, vanilla JavaScript ES modules, and two custom elements: `<moltivate-demo>` and `<club-board>`.

- Phone preview: three selectable views, looping playback with pause/replay, and a simulated workout and reward flow.
- Club: sample teams, search, progress/reward sorting, weekly/monthly filters, and individual crew details.
- Green app icon with a white **m** and orange dot, feature navigation, FAQ content, and a **coming soon** App Store action that opens an availability dialog.
- A pausable sponsor-logo ribbon links to the selected hackathon track ideas: GoDaddy's creative domain, planned Vultr deployment, planned Solana devnet challenges, and Chert video/vision exploration.
- A retro teammate-chat illustration, a sourced gym-photo Polaroid, and the **molt + motivate** origin story. Numbered image slots make personal photos easy to substitute; see [the image-slot guide](apps/web/IMAGE-SLOTS.md).
- Self-hosted Fraunces, DM Sans, and La Belle Aurore fonts; font sources and licenses are included with the assets.

The preview makes no wallet requests, camera requests, application API calls, or payments. Its SOL figures are illustrative display data, **not devnet balances or real payouts**. It does not create accounts, save workout results, or register visitors for a waitlist.

The sponsor marks describe the team's selected hackathon tracks, not customers, endorsements, or completed integrations. Chert supplies messaging/video infrastructure; its potential vision role is exploratory and does not replace the separate workout-verification plan. [Brand asset sources](apps/web/assets/sponsors/ASSET-SOURCES.md) and [photography sources](apps/web/assets/photos/ASSET-SOURCES.md) are recorded alongside the assets.

### Run locally

Requirements: **Node.js 20 or newer**, npm, and Python 3 for the simple local HTTP server. The frontend has no package dependencies, so no installation step is needed.

```sh
npm run check
npm run build
python3 -m http.server 5173 --directory dist
```

Open [http://localhost:5173](http://localhost:5173). `npm run check` checks JavaScript syntax; it is not a browser or end-to-end test suite. `npm run build` recreates `dist/` by copying `apps/web/`, including its assets. Edit the source files, rebuild, and refresh the browser. The Python server is for local preview, not production hosting.

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
| Domain identity | The selected `.club` direction; record the exact purchased hostname before configuring DNS and app links |
| Brand lines | “Are you Moltivated?” · “Stay Moltivated.” · “Put your money where your muscles are.” |

Entertainment is the team's chosen submission track. The demo should show an engaging competition, clear team contributions, and a complete workout-to-settlement loop. GoDaddy domain and other sponsor submissions depend on the event's actual rules; no prize eligibility is assumed here.

## Planned native MVP

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

## Planned stack

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
| `apps/web/` | Implemented browser frontend, custom elements, styles, and self-hosted assets |
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
