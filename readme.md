# Moltivate

**Put your money where your muscles are.**

Moltivate is a mobile-first web app for team workout accountability. Two teams
stake devnet SOL on a shared rep goal. Members do their squats in front of their
own camera, the browser counts them, and a Solana program settles who gets what
after the deadline. It's about showing up for your team, not about gambling:
devnet test SOL only, fixed house rules, no promises of returns.

**Are you Moltivated?**

Live app (devnet): https://moltivate-solo.vercel.app

> Status (2026-11-19): the full loop (create → join → camera workout → settle →
> claim) was run end to end on devnet from a local build of the original team
> project. On 2026-11-19 the same loop was run on this fork's deployment
> (moltivate-solo.vercel.app) with two wallets: create, join both teams, camera
> squats, settle after the deadline, claim on both wallets, close. Both runs
> predate accounts and wallet linking; the accounts version has not been run end
> to end. Phone camera and layout have not been checked on a real device yet.

## How it works

1. **Sign up or log in** with an email and password (the app is behind a login;
   an invite link shows a preview while signed out). Pick a unique display name,
   then **link your wallet** by connecting Phantom (desktop) and signing a
   message that proves you control it. Logging in is designed to work from a
   phone or desktop; the camera and layout have not been checked on a real
   phone.
2. **Create or join** a challenge (needs a linked wallet, on desktop Phantom). Joining a team deposits your stake into the
   program's escrow in the same transaction.
3. **Record** squats with your camera. MediaPipe Pose runs in the browser and
   counts reps from the knee angle, with a liveness prompt. Video never leaves
   the device; only the count is sent to `/api/workout-sessions`, which accepts it
   only if you're logged in and a wallet linked to your account owns the
   member account on chain. This is designed to work from a phone; the camera
   and layout have not been checked on a real device.
4. **Score**: the scoreboard shows each member's contribution.
5. **Settle**: after the deadline, the oracle route sums each member's sessions
   and signs the program's `settle()` instruction.
6. **Claim**: each member claims their payout from the program (desktop Phantom).

## Settlement rules

Enforced on chain in integer lamports, in
`programs/commitment-stakes/programs/commitment-stakes/src/math.rs` (with unit
tests). House constants are fixed, not creator-adjustable: floor (alpha) 20%,
rake 3%, both-pass bonus 5%.

- A team passes when its members' combined capped reps reach `members × goal`.
  One person counts for at most 150% of their own goal.
- **One team passes:** each losing member forfeits
  `stake × (alpha + (1 − alpha) × their shortfall ratio)`. The house takes
  `min(3% of total staked, total forfeits)`. Winners get their stake back plus the
  remaining forfeits, weighted by their capped reps. Rounding dust goes to the pot.
- **Both fail:** losses use the same formula; after the house cut, the remainder
  goes to the group's persistent pot.
- **Both pass:** no forfeits, no rake. Everyone gets their stake back plus an
  equal share of `min(5% of total staked, pot balance)`.

## Stack

| Layer | What is used | Where |
| --- | --- | --- |
| App and API | Next.js (React, TypeScript), App Router; API routes are the whole backend | `apps/app` |
| Hosting | Vercel, Root Directory `apps/app`, Node 24 | see `apps/app/DEPLOYMENT.md` |
| Wallet | Phantom via `@solana/wallet-adapter` (desktop; phone signing not built yet) | `apps/app` |
| Accounts | Supabase Auth: email/password, cookie sessions via `@supabase/ssr`, optional TOTP 2FA, wallets linked by a signed single-use message | `apps/app` |
| Workout capture | MediaPipe Pose (`@mediapipe/tasks-vision`) in the browser; squats counted in `lib/pose-squat-counter.ts` | `app/components/mediapipe-squat-session.tsx` |
| On-chain program | Anchor (Rust) on Solana devnet, `DhWeNpUmpxjSXdZ6iN1VCbP1WJVAYg9Yrprtx1LBPDum`: escrow, settlement math, claims | `programs/commitment-stakes` |
| Oracle | Server keypair in `/api/oracle/settle`; sums accepted sessions and signs `settle()` | `apps/app` |
| Database | Supabase Postgres: profiles (display names), linked wallets, workout sessions, closed challenges. An index for convenience; the program is the authority on funds | `supabase/migrations` |

## Repository guide

| Path | Purpose |
| --- | --- |
| `apps/app/` | The app: pages, components, API routes, `lib/` helpers, `lib/idl/` (a copy of the program IDL) |
| `programs/commitment-stakes/` | Anchor program; `src/math.rs` holds the settlement math and its unit tests |
| `supabase/migrations/` | Database schema, applied in filename order |
| `scripts/check-repository.mjs`, `tests/repository.test.js` | Repo guard: rejects gitlinks, keypairs, `.env` files and build output |
| `.github/workflows/app.yml` | CI: repo guard, `apps/app` lint, unit tests and build, and the program's `math.rs` unit tests |
| [AGENTS.md](AGENTS.md) | Contributor rules: financial correctness, trust model, verification expectations |

## Run locally

```bash
cd apps/app
npm ci
cp .env.example .env.local   # then fill in the values; see DEPLOYMENT.md
npm run dev
```

Checks:

```bash
# in apps/app
npm run lint
npm test          # node:test unit tests (API validation, accounts, challenge discovery)
npm run build

# at the repo root
npm ci
npm run ci        # repository guard and its tests
```

Building the Anchor program needs Linux or WSL2 (see `programs/commitment-stakes`).

## Trust model and known limits

- **Reps are counted in the user's browser, so a determined user can fake
  them.** Every session is stored as `trust_level: 'unverified'` and settlement
  counts them anyway. The pose tracking and liveness prompt only deter casual
  cheating. MediaPipe is a measurement input, not proof of identity.
- **The oracle and the program upgrade authority are single keys** held by the
  maintainer. This is not a trustless system, and the program's rules can change
  while an upgrade authority exists.
- **No timeout refund** if settlement never happens.
- **A phone is designed to log in, view challenges and record workouts (the
  camera and layout have not been checked on a real device), but cannot sign
  deposits, create a challenge or claim yet.** Phone wallet connect is blank in
  Phantom's in-app browser, so those actions need desktop Phantom. Phantom deep
  links are planned and not started.
- **Accounts:** identity is an email/password account (Supabase Auth). A wallet
  counts as yours only after you sign a single-use, expiring message that names
  the app, your account and the wallet. A wallet address on its own is never
  treated as proof of anything. Account routes re-check the session on the
  server (`requireAccount`), read linked wallets fresh on every request, and
  reject cross-origin POSTs. Optional TOTP 2FA is offered on the Account page
  only. Email links work only in the browser that requested them.
- Workout submissions are checked on chain against the challenge's membership,
  deadline and settled state, and are accepted only from the logged-in account
  whose linked wallet owns the member account. That stops other people
  submitting reps for you. It doesn't stop you faking your own.
- Closing a challenge requires a logged-in account with a linked wallet that is
  the creator or a member.
- **Verification status of accounts:** implemented and covered by unit tests and
  a mocked UI smoke test (against a fake Supabase). Not yet run against a real
  Supabase project, real Phantom, a real phone or devnet end to end. The
  accounts migration is not applied anywhere yet; see `apps/app/DEPLOYMENT.md`.
- The scoreboard polls every 5 seconds (and on tab focus); updates aren't pushed live.
- A challenge creator isn't automatically a player; they must join a team too.
- **Devnet only**, with test SOL. No real funds.

## Credits

Forked from a team project built at Emory Hacks (November 2026) and maintained
as a solo project by Stephen Roach.
