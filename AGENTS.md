# Moltivate contributor instructions

## Start here

If `HANDOFF.md` exists at the repo root, read it before anything else. It is
a work-in-progress note between sessions: current state, next steps, and
environment gotchas. It isn't always present; if it's missing, go by this file.

## What this repository is

**Moltivate** is a mobile-first web app for team workout accountability. Two
teams stake devnet SOL on a shared rep goal. People do their reps in front of
their camera, the browser counts them, and a Solana program settles who gets
what after the deadline.

This repository is **Stephen Roach's solo fork** of the hackathon project
(Emory Hacks, November 2026). It exists so that one person owns and
controls every part of it and can show it to recruiters. Keep it self-contained:

- **No dependencies on infrastructure Stephen doesn't own.** The original project's Chert FaceTime coach, Vultr VM worker and `staymoltivated.club` landing page belong to a teammate. They were removed from this fork deliberately; don't reintroduce them, link to them, or design around them.
- **Every service is Stephen's:** this GitHub fork, its own Vercel project, its own Supabase project, the devnet program (he holds the upgrade key), the oracle keypair, and his own devnet RPC key.
- **It's a portfolio piece.** Favour correct, readable, well-tested code and honest documentation over feature count. A recruiter reading the code or README should never find a claim the code doesn't back.

Distinguish clearly between implemented, verified, and planned behaviour in
code comments, docs and status reports. Never describe an unrun test,
simulated transaction or planned feature as working.

## Product direction

- Product name **Moltivate**. Brand line: **"Put your money where your muscles are."** Supporting copy: "Are you Moltivated?", "Stay Moltivated."
- The experience is about showing up, contributing to a team, and keeping commitments. Avoid casino styling, promises of returns, and pressure to raise stakes.
- Mobile-first web app (installable PWA). There is no native app and no separate marketing site; the app is the product.
- An avatar or evolution system is optional future scope. Don't copy Pokémon characters, names, artwork or interfaces.

## Stack (implemented)

| Layer | What is used | Where |
| --- | --- | --- |
| App and API | Next.js (React, TypeScript), App Router; API routes are the whole backend | `apps/app` |
| Hosting | Vercel, Root Directory `apps/app`, Node 24 | Stephen's Vercel project |
| Wallet | Phantom via `@solana/wallet-adapter`; desktop browsers work. On a phone you can log in, view challenges and record workouts, but deposits, creating a challenge and claims need desktop Phantom until phone signing is built (planned, not started) | `apps/app` |
| Accounts | Supabase Auth: email/password accounts, sessions in cookies via `@supabase/ssr` (`proxy.ts`, `lib/account-auth.ts`), optional TOTP 2FA, wallets linked to an account by a signed single-use message (`app/api/wallet-links`, `lib/wallet-proof.ts`) | `apps/app` |
| Workout capture | MediaPipe Pose (`@mediapipe/tasks-vision`) in the browser; squats counted from the knee angle (`lib/pose-squat-counter.ts`), with a liveness prompt. Video never leaves the device; only the count is sent | `app/components/mediapipe-squat-session.tsx` |
| On-chain program | Anchor (Rust) on Solana devnet: escrow, settlement math, claims | `programs/commitment-stakes` |
| Oracle | Server keypair in `/api/oracle/settle`; sums accepted sessions and signs `settle()` | `apps/app` |
| Database | Supabase Postgres: profiles (display names), linked wallets, workout sessions, closed challenges. An index for convenience, never the authority on funds | `supabase/migrations` |
| RPC | A dedicated devnet RPC endpoint (Helius) via `NEXT_PUBLIC_SOLANA_RPC_URL`; it ships in the browser bundle, so use a devnet-only key | Vercel env |

There is **one** capture path: the browser. There is no server-side CV worker,
no FaceTime/Chert integration, and no separate Python or FastAPI service. If
server-side verification is ever added, it is a new, deliberately reviewed
design. Don't revive the old worker contract.

Recheck current package names and compatibility before changing Solana or
Anchor dependencies; don't mix incompatible Solana client generations. Pin
versions in lockfiles and record why.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/app/` | The app: pages, components, API routes, `lib/` helpers, `lib/idl/` |
| `programs/commitment-stakes/` | Anchor program; `src/math.rs` holds the settlement math and its unit tests |
| `supabase/migrations/` | Database schema, applied in filename order |
| `scripts/check-repository.mjs`, `tests/repository.test.js` | Repo guard: rejects gitlinks, keypairs, `.env` files and build output from the index |
| `.github/workflows/` | CI: repo guard, `apps/app` lint/test/build, program unit tests |

## Working on the app (`apps/app`)

- Before finishing any change, run `npm run lint` and `npm run build` in `apps/app`. At the root, run `npm run ci`.
- `apps/app/tests/ui-smoke.mjs` is a Playwright UI smoke test using mocks, including a fake Supabase (`tests/fake-supabase.mjs`). It needs the app built against that fake with obviously fake keys; the exact commands (bash and PowerShell) are in the header of the script and in `docs/APP_DESIGN.md`. Rebuild without those variables afterwards. Mocked tests don't replace a real devnet run or a real Supabase run.
- Secrets live in `apps/app/.env.local` (gitignored) and in Vercel's Production env vars. The variables are `NEXT_PUBLIC_SOLANA_NETWORK`, `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public by design; the anon/publishable key only, never the service-role key), `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_ORACLE_PUBKEY` and `ORACLE_SECRET_KEY`.
  - Never put a secret in a `NEXT_PUBLIC_*` variable.
  - Never print, log or commit any value.
  - Keep a redacted `.env.example` in sync when variables change.
- `apps/app/lib/idl/` is a **manual copy** of the program's IDL. If the program changes, rebuild it and copy the IDL again. Never hand-edit the IDL instead.
- Anchor and Solana builds need WSL2 on Stephen's Windows machine; Windows `rustc` can't build the program. Pure frontend work doesn't need WSL.
- Deploy with `vercel --prod` from `apps/app`, or through the Vercel Git integration if it's connected. Never deploy this fork to the original project's Vercel project (`moltivate`).

## Settlement rules (enforced on chain — the source of truth)

House constants: alpha (floor) 20%, rake 3%, both-pass bonus 5%. These are
fixed in the create form, not creator-adjustable.

- A team passes when its members' combined capped reps reach `members × goal`. One person counts for at most 150% of their own goal.
- **One team passes:**
  - Each losing member forfeits `stake × (alpha + (1 − alpha) × their shortfall ratio)`.
  - The house takes `min(3% of total staked, total forfeits)`.
  - Winners get their stake back plus the remaining forfeits, weighted by their capped reps. Any rounding dust goes to the pot.
- **Both fail:** losses use the same formula; after the house cut, the remainder goes to the group's persistent pot.
- **Both pass:** no forfeits, no rake. Everyone gets their stake back plus an equal share of `min(5% of total staked, pot balance)`.

Don't change these rules, the trust tiers or payout logic as a side effect of
other work. Change them only when Stephen asks, version the change, and never
let it silently rewrite an already-funded challenge.

## Financial correctness

- Devnet with test SOL only. Mainnet or real funds need a separately requested, reviewed release.
- Never collect a seed phrase or private key; approvals happen in the wallet.
- Use integer lamports and checked arithmetic. No floating point for payouts, and no JavaScript `Number` beyond its safe range; serialize large integers explicitly.
- Treat an RPC submission as pending. Verify transaction success and the resulting on-chain state before showing a deposit, payout or refund as done.
- Keep deposit and enrollment atomic. Enforce team limits, unique enrollment, fixed rules and deadlines in the program.
- Verify signer, account ownership, PDA seeds, challenge identity, member identity and state on every instruction.
- Reject duplicate settlement, double claims, unauthorized result submission, and any state where a refund and a payout could both be claimed for one stake.
- Reconcile uncertain transaction outcomes before resubmitting. Persist signatures and idempotency keys.
- Conserve funds: every staked lamport ends up paid out, in the treasury or in the pot. Specify rounding, ties, empty results, incomplete rosters and timeouts before coding the happy path.
- Be explicit that the oracle and the program's upgrade authority are single keys Stephen holds. Never call the system trustless, and never claim program rules can't change while an upgrade authority exists.

## Verification, authentication and data

- Client-reported rep counts are **untrusted**. Every browser session is stored as `trust_level: 'unverified'`, and settlement currently counts them. Say so plainly; don't add a path that lets a caller assert a higher trust level without a real, reviewed verifier.
- Validate everything at API boundaries: pubkeys, membership, deadlines, idempotency keys, and integer, non-negative reps. Never credit one session twice.
- A supplied wallet address alone is not authentication. Identity is an email/password account (Supabase Auth). A wallet is tied to an account only by a signed, expiring, single-use message bound to the app, the account and the wallet (`lib/wallet-link-message.ts`, `lib/wallet-proof.ts`). Account-bound API routes call `requireAccount` and read the account's linked wallets fresh on each request, so unlinking takes effect immediately. Cookie-authenticated POSTs also check that `Origin` matches the request origin (`lib/same-origin.ts`).
- Accounts, wallet linking and the new workout authorization are implemented and covered by unit tests and the mocked UI smoke test only. They have not been run against a real Supabase project, real Phantom, a real phone or devnet end to end; `apps/app/DEPLOYMENT.md` lists the setup and checks still owed.
- MediaPipe pose estimation is a measurement input, not a medical assessment or proof of identity or liveness. Describe its anti-cheat limits honestly.
- Keep video, pose data, tokens and personal details off-chain and out of logs. The browser path sends counts only.
- Never stage `.isolated/`, recovery patches or bundles, build output, validator ledgers, wallets or keypairs. Check `git diff --cached --summary` for mode 160000 (gitlinks) before pushing.

## Known gaps (state them, don't hide them)

- Browser-counted reps can be faked by a determined user.
- Workouts are authorized by the logged-in account whose linked wallet is the member account's on-chain owner (`lib/linked-wallets.ts`, `app/api/workout-sessions`). This stops other people submitting reps for you, not you faking your own reps.
- No timeout refund if settlement never happens.
- Phone wallet connect is blank in Phantom's in-app browser, so a phone cannot sign deposits, create or claim yet. Planned (project 2: Phantom deep links), not started. Desktop works.
- Email links (confirmation and password reset) only work in the browser that requested them (PKCE).
- Optional 2FA (TOTP) is offered only on the Account page; sign-up doesn't nudge towards it.
- Display-name uniqueness is case-insensitive but doesn't fold look-alike characters from other scripts.
- The signed-in check in `proxy.ts` is a quick session check; every API route re-verifies with `requireAccount`.
- The 12-character minimum password is enforced in the browser; the server-side enforcement is the Supabase dashboard setting, which Stephen must set.
- The scoreboard polls every 5 seconds (and on tab focus); updates aren't pushed live.
- A creator isn't automatically a player; they must join a team too.

## UX expectations

Make the next action and the current state obvious. Distinguish wallet
approval, pending transaction, confirmation, camera active, counting, upload,
rejection, settlement and claim. Show the network, stake, rules, deadline and
refund conditions before a deposit. Show each member's contribution. Respect
camera consent and handle a denied camera clearly. Preserve keyboard
navigation, focus states, reduced-motion behaviour and phone-width layouts.

## Implementation workflow

1. Read the files you'll touch, this file and `HANDOFF.md` before editing. Don't assume a layout exists.
2. Choose the smallest complete change that advances the core loop: connect → join/deposit → record → score → settle → claim.
3. Make routine, reversible decisions yourself and state them. Ask Stephen only when a product or financial rule would change.
4. Keep unrelated work intact; avoid broad refactors and new infrastructure without a demonstrated need.
5. Update the README, `DEPLOYMENT.md` and this file alongside code. Document only commands that exist and that you've run.
6. Report what changed, what you actually ran, and any limitation. Don't push, force-push or deploy unless Stephen asks.

## Verification expectations

- **Program:** `math.rs` unit tests (worked example, conservation, ties, zero scores, rounding, overflow). Add instruction-level tests for authority checks, deadlines, duplicate settlement and double claims when touching `lib.rs`.
- **API:** validation, idempotency, membership and deadline checks, and the trust level forced to `unverified`.
- **End to end:** before calling the app demo-ready, run one real devnet loop on the deployed URL with two wallets: create → join both teams → camera squats → settle after the deadline → claim both → inspect the Explorer receipts.
- **Devices:** check camera and layout on a real phone, not only devtools emulation.
