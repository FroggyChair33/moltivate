# Handoff: Moltivate / Commitment Stakes

Written mid-session for a fresh agent to pick up. Committed for convenience
(so a fresh clone sees it immediately) - fine to remove from tracking later
once it's served its purpose.

## What this project is

**Moltivate** — a hackathon app ("Entertainment" track). **Commitment
Stakes**: friends form two teams, each member stakes devnet SOL, teams
compete to hit a weekly workout goal, losing-side members forfeit part of
their stake weighted by their own shortfall, winners split the forfeits.

**Source of truth for product rules**: `C:\Users\steph\Downloads\Commitment
Stakes — Team Workout Accountability MVP.md` (also copy-pasted into
`AGENTS.md` at the repo root, which is itself the contributor-instructions
file every agent should read first — it supersedes `readme.md`/
`architecture.md` wherever they conflict, since those predate the MVP doc's
stack pivot).

**Stack** (decided and locked in, see `AGENTS.md` "Technical direction"):
mobile-first **Next.js web app** (`apps/app/`) — no native app — with
**Next.js API routes** as the backend (no separate FastAPI/Python service).
Anchor/Rust program on Solana devnet for escrow+settlement. Supabase
(Postgres) for off-chain workout-session evidence only. `apps/web/` is a
*separate*, pre-existing marketing/landing page (vanilla JS, untouched,
unrelated to the functional app).

GitHub repo: `betrji/moltivate` (private). User's GitHub: `FroggyChair33`.
This machine's git/gh auth already works natively on Windows and inside
WSL2 Ubuntu (both configured this session).

## Repo layout that matters

- `programs/commitment-stakes/` — the Anchor program. **Done and tested.**
  - `programs/commitment-stakes/src/lib.rs` — `initialize`,
    `initialize_group`, `join_team`, `settle`, `claim`. Accounts: Challenge,
    Vault, Treasury, Pot (persistent per-creator group pot), Team (x2),
    TeamMember.
  - `src/math.rs` — pure settlement math (`member_loss_lamports`,
    `house_cut_lamports`, `winner_share_lamports`, `bonus_pool_lamports`,
    `team_goal_units`/`team_passes`), unit-tested against the MVP doc's
    exact worked example (two teams of 3, S=1 SOL, alpha=2000bps,
    rake=300bps) — 11/11 pass.
  - `tests/commitment-stakes.ts` — **real local-validator** integration
    tests (not just unit tests), 9/9 pass: full worked example end-to-end,
    both-lose, both-win, and 6 negative/guard tests (duplicate settle,
    claim-before-settle, double-claim, non-oracle settle,
    settle-before-deadline, double-join).
  - `idl/commitment_stakes.json` + `.ts` — committed, generated IDL/types
    (not hand-authored). **Copy these into `apps/app/lib/idl/` any time the
    program changes** — that's a manual step, nothing automates it.
  - This is all merged to `main` (PRs #12, #13, #15).

- `apps/app/` — the real Next.js app. **PR #16 wires it to the real
  program (create/join/scoreboard/results) - confirmed still OPEN/
  unmerged** (`stephen/wire-frontend-to-anchor-program` branch; `main` as
  of this writing still has the old mocked pages from PR #14). Check
  `gh pr view 16 --repo betrji/moltivate` for current status before
  assuming either way.
  - `lib/anchor.ts` — program client + every PDA derivation helper
    (`challengePda`, `vaultPda`, `treasuryPda`, `potPda`, `teamPda`,
    `memberPda`, `fetchChallengeMembers`). Mirrors `lib.rs`'s seeds exactly.
  - `lib/use-program.ts` — `useProgram()` hook, wallet-adapter-aware,
    returns `null` until a wallet is connected.
  - `lib/oracle.ts` — **server-only** (`import "server-only"`). Builds an
    `AnchorProvider`/`Program` signed by a dedicated oracle `Keypair`
    (`ORACLE_SECRET_KEY` env var), not the user's wallet.
  - `lib/supabase-server.ts` — **server-only** Supabase client using the
    service-role key.
  - Pages: `app/challenges/new/page.tsx` (create — calls `initialize`),
    `app/join/[code]/*` (join — calls `join_team`; the invite "code" is just
    the challenge account's own base58 address, nothing separate to look
    up), `app/challenges/[id]/*` (scoreboard — reads real TeamMember
    accounts via `getProgramAccounts`) and `.../results/*` (results/claim —
    reads settlement state, `ClaimButton` calls `claim`, has a **"Settle
    now" button** that POSTs to the oracle route below).
  - `app/api/workout-sessions/route.ts` — records a claimed workout session
    into Supabase. **Honest gap**: there is no real CV/Chert verifier
    wired up anywhere, so every session this records is `trust_level:
    'unverified'` regardless of which "source" button was clicked. Don't
    let a future pass accidentally claim verification that isn't there.
  - `app/api/oracle/settle/route.ts` — **the piece built this session,
    least-verified of everything here.** POST `{ challenge: "<pubkey>" }`
    to settle one challenge, or POST `{}` to scan on-chain for every
    challenge past its deadline and settle all of them (cron-friendly).
    Sums `workout_sessions.reps` (status='accepted', **no trust_level
    filter — known gap**, see the file's own comment) per member, calls
    `settle()` signed by the oracle keypair.

- `supabase/migrations/`
  - `20261114010000_commitment_stakes_schema.sql` — original schema from an
    earlier PR. Defines `users`/`challenges`/`teams`/`team_members` as a
    full off-chain mirror, which **nothing populates** — create/join call
    the Anchor program directly and never write these tables. They're not
    wrong, just currently inert/unused placeholders for later off-chain
    indexing (e.g. a cross-challenge dashboard by wallet).
  - `20261114020000_workout_sessions_onchain_keys.sql` — **written this
    session.** Re-keys `workout_sessions` away from `team_members.id` (a
    table nothing populates) to `challenge_pubkey`/`team_member_pubkey`
    text columns holding real on-chain addresses directly. Rationale: the
    chain is already the authoritative roster (every Challenge/Team/
    TeamMember account is fully queryable), so mirroring it into a parallel
    off-chain table before `workout_sessions` could reference anything
    would just be duplicate bookkeeping with sync-drift risk, for no
    benefit right now. Validated against the real Supabase instance inside
    a rolled-back transaction (both migrations applied cleanly in
    sequence) — **not yet actually applied for real** (that's a deliberate
    "propose, don't auto-apply" choice, not an oversight — someone with
    intent to actually migrate the live schema should run it, e.g. via the
    Supabase dashboard's SQL editor or the CLI).

## State of things right now, precisely

1. **Four PRs merged to `main`** this session (#12 AGENTS.md pivot + app
   scaffold, #13 Anchor build config, #14 Next.js schema/wallet/pages
   [mocked data], #15 join/settle/claim + tests).
2. **PR #16 open, unmerged** (`stephen/wire-frontend-to-anchor-program`):
   wires the frontend to the real program, replacing #14's mocked pages.
   Build+lint clean, routes smoke-tested at 200, **never click-tested with
   an actual funded wallet in a real browser** (can't drive a browser/
   Phantom extension from this session).
3. **Oracle/backend work (this session, stashed - not committed, not a
   PR, not even on a branch of its own):**
   - It currently lives in a `git stash` entry (message "wip oracle
     backend work") on top of the `stephen/wire-frontend-to-anchor-program`
     branch. Run `git stash list` to confirm it's still there, then
     `git checkout stephen/wire-frontend-to-anchor-program && git stash pop`
     to bring it back into the working tree before doing anything else
     with it.
   - Files created (once popped): `lib/oracle.ts`, `lib/supabase-server.ts`,
     `app/api/oracle/settle/route.ts`, the new migration file, `.env.local`
     (gitignored, has the real oracle secret key — see below),
     `.env.example` additions.
   - Files modified: `app/api/workout-sessions/route.ts` (501 stub → real
     insert), `app/components/log-session-stub.tsx` (now sends
     `challengePubkey`+`teamMemberPubkey`+real `reps`, not a mock id),
     `app/challenges/[id]/client.tsx` (finds the connected wallet's own
     TeamMember to pass to the log-session component, instead of
     hardcoding `members[0]`), `app/challenges/new/page.tsx` (oracle field
     now defaults to `NEXT_PUBLIC_ORACLE_PUBKEY`, not the creator's own
     wallet), `app/challenges/[id]/results/client.tsx` (added the "Settle
     now" button + deadline display).
   - **Last action taken before stashing**: fixed a TypeScript error in
     `app/api/oracle/settle/route.ts` (the same Anchor generated-type quirk
     documented in `claim-button.tsx` — an account with `relations` mixed
     with `pda` accounts on the same instruction makes TS reject *any*
     inline object literal with all the right keys; fix is to build the
     accounts object as its own `const` first, since excess-property
     checking only applies to inline literals, not variables).
   - **`npm run build` has NOT been re-run since that last fix.** That's
     the immediate next step after popping the stash — confirm it's
     actually clean now.

## Secrets / credentials handling (read before touching any of this)

- **`apps/app/.env.local`** (gitignored; will reappear once the stash above
  is popped) contains:
  - `ORACLE_SECRET_KEY` — a freshly generated devnet keypair's secret, JSON
    array of 64 bytes. **This is a real secret.** It was generated this
    session via plain `Keypair.generate()`, printed once to terminal
    output (now in this session's transcript — acceptable, devnet-only,
    no real value, but still don't needlessly re-print it), and written
    directly to `.env.local`. Never echo it in chat replies.
  - `NEXT_PUBLIC_ORACLE_PUBKEY=2Cx6GwT6fqMbEQuHxJS42vjgSBvA51AmabMkxqPEcUwS`
    — the public half, safe to share/display freely, this is what
    challenges should set as their `oracle` field by default.
- **This oracle wallet is UNFUNDED.** `solana airdrop` to it hit the same
  devnet faucet rate-limit seen repeatedly this session. It needs devnet
  SOL (even a small amount, just for tx fees) before `settle()` can
  actually succeed on-chain. Fund it via faucet.solana.com (GitHub
  sign-in gets a higher cap than the CLI) with address
  `2Cx6GwT6fqMbEQuHxJS42vjgSBvA51AmabMkxqPEcUwS`. This blocks any real
  end-to-end test of the settle route.
- **Missing, not yet available to this session**: the actual Supabase
  project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. The only thing available so far is a raw
  Postgres connection string (`DATABASE_URL` in `C:\Users\steph\
  EmoryHacksDevEnvironment\slack-agent\.env`, used purely to validate
  migration SQL via psycopg2 inside rolled-back transactions) — that is
  **not** the same thing as the Supabase REST API URL/keys
  `@supabase/supabase-js` needs. Without these three vars in `.env.local`,
  `/api/workout-sessions` and `/api/oracle/settle` will throw immediately
  (`getSupabaseServerClient` throws if either var is unset). Ask the user
  for these or find them in the Supabase dashboard (Project Settings →
  API).

## Known environment gotchas (learned the hard way this session — don't
   rediscover these)

- **WSL2 only, for the Rust/Solana/Anchor toolchain.** Native Windows
  cannot see anything installed inside WSL2. The toolchain is fully set up
  inside `wsl -d Ubuntu` on this machine (Rust via rustup, Solana CLI 2.3.0
  via `release.anza.xyz`, Anchor 0.32.1 via AVM, Node 22, `gh` reusing the
  Windows gh auth token). `slack-agent`'s own `AGENT_RUN_IN_WSL` feature
  (separate subsystem, not relevant to this app) exists for the same
  reason if you ever see it referenced.
- **`cargo build-sbf`'s default bundled platform-tools (v1.48, rustc
  1.84.1) can't compile a transitive dependency needing Rust's
  `edition2024`.** Fixed by symlinking `~/.cache/solana/v1.48/platform-
  tools/rust` to the newer `v1.58` one (rustc 1.95.0) inside WSL2 — a
  machine-local cache hack, not a repo change. If `anchor build` ever
  fails with an `edition2024` error again on a fresh machine, the real fix
  is `cargo build-sbf --tools-version v1.58` explicitly (or whatever's
  current) rather than relying on the default.
- **`anchor idl build` has a nasty self-inflicted bug**: if you redirect
  its stdout to `target/idl/commitment_stakes.json` directly, the shell
  truncates that file to 0 bytes *before* the command even runs, and
  Anchor's own startup scan of `target/idl/` then chokes on its own
  about-to-be-written empty file (`EOF while parsing a value`). Always
  write to a scratch path first, then move/copy into place.
- **WSL2's `/tmp` is tmpfs and gets wiped** whenever the lightweight VM
  restarts (which happens after idle periods) — don't rely on anything in
  `/tmp` surviving between separate tool calls. Use the project directory
  or `~/.cache` instead.
- **Memory pressure**: this machine has run low on free RAM more than
  once this session (as low as ~1.2 GB free out of ~16 GB), which once
  got a long-running `anchor test` killed by Claude Code's own OOM guard.
  Check `Get-CimInstance Win32_OperatingSystem | Select-Object
  @{N='FreeGB';E={[math]::Round($_.FreePhysicalMemory/1MB,2)}}` before
  kicking off anything validator-heavy.
- **Anchor's generated TS account-resolution types are genuinely quirky**
  for any instruction mixing a `relations`-based account with `pda`-based
  accounts (both `claim` and `settle` hit this). The type rejects *every*
  combination of keys when passed as one inline object literal — not a
  real logic bug, confirmed empirically by testing every subset. Fix:
  build the accounts object as its own `const` first, then pass the
  variable to `.accounts(...)` — TypeScript's excess-property checking
  only applies to inline literals, so this sidesteps it cleanly without
  an `any` cast or `@ts-expect-error`.
- **Local Supabase SQL validation pattern** that's safe to reuse: open a
  psycopg2 connection via the `DATABASE_URL` in
  `slack-agent/.env`, `cur.execute(sql)`, then always `conn.rollback()` —
  confirms a migration applies cleanly against the *real* instance without
  ever persisting anything. The Claude Code permission system treats this
  as a sensitive action and will ask for confirmation the first time in a
  session; that's expected, not a bug.
- **Vercel/Next.js-side**: this is Next.js 16 with Cache Components
  enabled (`cacheComponents: true`). Any page reading `params` or doing
  real data fetching needs `export const instant = false` or it tries
  (and fails) to prerender a static shell. Every dynamic page already has
  this; copy the pattern for new ones.

## Immediate next steps, in order

1. `git stash list` to confirm the oracle work is there, then
   `git checkout stephen/wire-frontend-to-anchor-program && git stash pop`.
2. Re-run `npm run build` (and `npm run lint`) in `apps/app/` to confirm
   the last fix actually resolved the TS error with no new ones.
3. Get the three real Supabase API env vars from the user and add them to
   `.env.local` (not `.env.example`) so the two API routes are actually
   testable.
4. Get the oracle wallet funded (ask the user to use faucet.solana.com, or
   retry the CLI airdrop if enough time has passed since the last
   rate-limit hit).
5. Decide whether to commit/push this oracle work as its own PR (stacked
   on `stephen/wire-frontend-to-anchor-program`, same as how #15 stacked
   on #13) once it passes build/lint.
6. Real end-to-end test still outstanding regardless of the above: create
   a challenge, join with a couple of funded devnet wallets, log a few
   workout sessions, wait past the deadline, hit "Settle now", confirm the
   results page shows real payouts, claim them. Needs a real browser with
   Phantom — not drivable from this session.
7. Longer-term, not blocking: the `apps/web` landing page's teammate (if
   any) hasn't been involved in this thread of work at all; Chert/MediaPipe
   capture is still fully unbuilt (intentionally out of scope so far, see
   `AGENTS.md`); the off-chain `users`/`teams`/`team_members` tables from
   the first migration remain unpopulated placeholders - decide at some
   point whether to actually wire create/join to also write them (for a
   future cross-challenge dashboard) or drop them from the schema entirely.
