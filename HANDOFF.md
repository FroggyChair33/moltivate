# Handoff: Moltivate / Commitment Stakes

Written mid-session for a fresh agent to pick up. Committed for convenience
(so a fresh clone sees it immediately) - fine to remove from tracking later
once it's served its purpose.

## Resume here (14 November 2026)

Start from [PR #16](https://github.com/betrji/moltivate/pull/16), which is
open at `78cf4f0a46b416a2b2c9ce65614935b2ffcd81fe`. This handoff is on
`main`. The older sections record the original work and environment audit.

The user has no access to the old machine or a backup of the
`wip oracle backend work` stash. No recovery copy was found in this clone or
the remote branches. The old oracle route, Supabase server client, and
migration described below were never recovered or published.

### Changes to carry forward

- **Challenge creation.** Anchor could not resolve the `pot` account during
  `initialize`. The create page now passes the group pot PDA it already
  derived through `.accountsPartial()`.
- **Workout storage.** The new migration adds the Anchor Challenge and
  TeamMember references while preserving legacy UUID references. It enforces
  scoped submission-key uniqueness, enables row-level security, and rejects
  acceptance of unverified on-chain-keyed sessions. The app README
  documents that boundary.
- The three files exist locally in the `frontend-pot-account` worktree.
  Only this handoff is being pushed. On a clean checkout of the PR head,
  copy the inline diff below to a temporary patch file outside the repo.
  Run `git apply --check <patch-file>` and then `git apply <patch-file>`.
  Inspect existing edits first if using an active checkout.

### What passed

- Lint and the Next.js production build passed on the patched PR snapshot.
- Browser smoke testing used an injected Phantom test double with a disposable
  signer on a loopback Solana validator. It confirmed creation, join/deposit,
  scoreboard and results loading, and creation of a second challenge using
  the same group pot. Challenge and member accounts were checked through RPC.
  React hydration error #418 occurred on reloads with a selected wallet.
  Physical Phantom, devnet, browser claims, and oracle settlement remain
  unverified.
- Both migrations applied in disposable PGlite PostgreSQL on a fresh database
  and as an upgrade with an existing workout row. Checks covered legacy
  preservation, reference validation, duplicate rejection, acceptance on insert
  and update, and denial of direct reads and writes by a client role.
  The migration has not been applied to live Supabase.

### Next backend increment

The workout POST route still returns a stub. Implement wallet authentication
using a signed, expiring, single-use challenge bound to the app, wallet and
session. Derive membership from the authenticated wallet and verify the
Challenge and TeamMember accounts and eligibility on-chain before writing.
Use the submission key to reconcile retries. Treat client counts and
simulated workouts as unverified data. Settlement needs trusted verifier
output, cutoff rules, authorization, and transaction reconciliation before
it can run. Supabase and oracle credentials are unavailable in this checkout.
Keep any future credentials out of Git and patch exports.

### Transfer patch

```diff
diff --git a/apps/app/README.md b/apps/app/README.md
index e215bc4..452024b 100644
--- a/apps/app/README.md
+++ b/apps/app/README.md
@@ -16,6 +16,19 @@ bun dev
 
 Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
 
+## Workout session storage
+
+The migrations in [supabase/migrations](../../supabase/migrations) support
+workout records keyed by the Anchor Challenge and TeamMember accounts. The
+existing UUID membership reference remains valid for older rows. Submission
+keys must be unique per challenge and member. The database rejects an
+accepted on-chain-keyed record with an unverified trust level.
+
+Workout sessions use row-level security. The app server must authenticate the
+wallet and verify the member's ownership, challenge and eligibility on-chain
+before writing a session. The current workout route still returns a stub
+response. Capture, verification and oracle settlement need their own wiring.
+
 You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.
 
 This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.
diff --git a/apps/app/app/challenges/new/page.tsx b/apps/app/app/challenges/new/page.tsx
index e22b287..337cfae 100644
--- a/apps/app/app/challenges/new/page.tsx
+++ b/apps/app/app/challenges/new/page.tsx
@@ -63,7 +63,8 @@ export default function NewChallengePage() {
           teamAName,
           teamBName,
         })
-        .accounts({
+        .accountsPartial({
+          pot,
           teamA: teamPda(challenge, 0),
           teamB: teamPda(challenge, 1),
         })
diff --git a/supabase/migrations/20261115013000_workout_sessions_onchain_membership.sql b/supabase/migrations/20261115013000_workout_sessions_onchain_membership.sql
new file mode 100644
index 0000000..f5b839f
--- /dev/null
+++ b/supabase/migrations/20261115013000_workout_sessions_onchain_membership.sql
@@ -0,0 +1,27 @@
+-- The app enrolls members in Anchor. Accept those account addresses without
+-- requiring a duplicate roster in Postgres. Preserve existing UUID references.
+alter table public.workout_sessions
+    alter column team_member_id drop not null,
+    add column challenge_pubkey text,
+    add column team_member_pubkey text,
+    add constraint workout_sessions_membership_reference_check check (
+        (team_member_id is not null and challenge_pubkey is null and team_member_pubkey is null)
+        or (
+            team_member_id is null
+            and challenge_pubkey is not null
+            and challenge_pubkey ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
+            and team_member_pubkey is not null
+            and team_member_pubkey ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
+        )
+    ),
+    add constraint workout_sessions_onchain_idempotency_key
+        unique (challenge_pubkey, team_member_pubkey, idempotency_key),
+    add constraint workout_sessions_onchain_acceptance_check check (
+        team_member_pubkey is null or status <> 'accepted' or trust_level <> 'unverified'
+    ),
+    enable row level security;
+
+comment on column public.workout_sessions.challenge_pubkey is
+    'Anchor Challenge account. The server must verify the challenge and member relationship on-chain.';
+comment on column public.workout_sessions.team_member_pubkey is
+    'Anchor TeamMember account. The server must verify that the authenticated wallet owns this membership.';
```

## Frontend continuation (14 November 2026)

- GitHub reports [PR #16](https://github.com/betrji/moltivate/pull/16) open at
  `78cf4f0`. The local stash, Git history and the current GitHub branch list
  yielded no recovery copy of the stashed oracle/backend changes.
- A browser run against the local validator reproduced a create failure on
  the PR head. Anchor could not infer the `pot` account because its seeds
  include the existing pot's own stored ID. The create page now supplies the
  already derived pot address through `.accountsPartial()` in the attached
  `frontend-pot-account` worktree based on the PR head. The fix is local.
- The patched snapshot passed lint and the Next.js production build. With an
  injected Phantom test double and a disposable signer on loopback, the
  browser created a challenge, joined and deposited, loaded the scoreboard and
  results, and created a second challenge using the same pot. The challenge
  and member accounts were checked independently through RPC. React emitted
  hydration error #418 on reloads with the selected wallet. The flow still
  passed. Physical Phantom, devnet, oracle settlement and browser claims
  remain unverified.
- Resuming the old backend changes requires a code-only copy of the
  `wip oracle backend work` stash or equivalent source files. Keep local
  environment files, wallet keys and credentials out of the patch.

## Windows and WSL compatibility audit (14 November 2026)

The audit resumed on `main` at `d998294`. The results here supersede the
initial setup status below. The checkout still has the stubs described below
and the old oracle/backend stash is absent. The audit changed local setup and
this handoff only.

- Windows Node **24.22.1** and npm **11.19.1** run from the existing
  `.local-tools/node-v24.22.1-win-x64/` directory. All three repository npm
  installs succeeded with `npm ci --ignore-scripts` using their lockfiles.
  Windows owns the root and `apps/app/` installs. Ubuntu owns the
  `programs/commitment-stakes/` install. System PATH was left alone.
- In PowerShell from the repo root, use the following environment for root
  checks and browser tests. Playwright's pinned Chromium headless shell was
  installed here with `npm.cmd exec --offline -- playwright install --only-shell chromium`.

  ```powershell
  $env:PATH = "$PWD\.local-tools\node-v24.22.1-win-x64;$env:PATH"
  $env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.local-tools\playwright-headless"
  npm.cmd run ci
  ```

  The full root CI command passed syntax and build checks and reported
  **34 Playwright tests passed, 8 skipped** across three viewport profiles.
- On Windows, `npm.cmd --prefix apps/app run lint` and
  `npm.cmd --prefix apps/app run build` passed. A production-server smoke
  test returned HTTP 200 on all five app pages. The workout API returned
  400 for invalid input and 501 for a valid stub submission. Next.js warned
  about multiple lockfiles and inferred the repo root. npm reported dependency
  peer and deprecation warnings. The app build reached its Google Fonts sources.
- Ubuntu's Bash login shell picks up Anchor **0.32.1**, Solana and the local
  validator **2.3.0**, and host Rust **1.100.0**. Linux Node **24.22.1** was
  downloaded from nodejs.org, verified against the published SHA-256, and
  installed in `.local-tools/node-v24.22.1-linux-x64/`. Run contract commands
  with `wsl -d Ubuntu` and source `.local-tools/audit-wsl-node.sh` from the repo
  root before changing directories for npm. Ubuntu otherwise finds Windows npm.
  `cargo test --locked` in `programs/commitment-stakes/` passed **11 tests**,
  with Anchor macro `unexpected_cfgs` warnings.
- `anchor idl build` with `--locked` regenerated both IDL files into
  `target/audit-idl/` under the contract workspace. The JSON matched the
  committed IDL semantically and the TypeScript differed only in line endings.
- On Node 24, plain `npm test` in the contract workspace stopped during
  test loading with `ERR_IMPORT_ATTRIBUTE_MISSING` for the JSON IDL.
  Use `NODE_OPTIONS=--no-strip-types npm test` in Ubuntu so the test runner
  uses the suite's CommonJS TypeScript configuration. The local validator
  helper applies the flag to that command only.
- Solana 2.3.0 compiled the locked SBF program with
  `cargo build-sbf --jobs 4 --tools-version v1.58 -- --locked` and an
  explicit ignored output directory. The selected SBF Rust compiler was
  **1.95.0-dev**. The first run also initialized Solana 2.3.0's default
  v1.48 SDK tools for the post-build strip step. No manual SDK cache symlink
  was needed. See [Anza's platform-tools v1.58 release](https://github.com/anza-xyz/platform-tools/releases/tag/v1.58).
- **9 transaction tests passed** on the Solana 2.3.0 local validator. The
  audit loaded the compiled program at its declared address at genesis on
  loopback, funded a disposable local provider wallet there, and used the
  checked-in TypeScript suite. The repeat SBF build produced a byte-identical
  binary. The helper stops its validator and removes the disposable wallet.
  To repeat from the repo root on this machine, run these ignored local
  helpers from PowerShell.

  ```powershell
  wsl -d Ubuntu -- bash -lc 'bash .local-tools/audit-wsl-sbf.sh'
  wsl -d Ubuntu -- bash -lc 'bash .local-tools/audit-wsl-validator.sh'
  ```

- The configured WSL provider wallet file exists and parses. This audit
  used the disposable wallet and local ledger. Devnet, Supabase and physical
  wallet/camera use were outside the audit. The app environment files and
  previous oracle/backend stash are absent from this checkout.
- This Codex sandbox denied WSL, external downloads, and loopback HTTP by
  default. The respective checks ran after automatic review approved escalation.

## Initial findings: new machine environment audit (14 November 2026)

This section supersedes the older machine-specific assumptions and immediate
next steps below. The user is starting a new Codex project/conversation in this
same directory. **Finish checking and fixing this machine's environment before
beginning product work.** The audit was interrupted for this handoff; setup is
not complete. No product code was changed, no branch was switched, and no
application, browser, Rust, validator, or devnet tests were run in this session.

### Repository and work recovery

- Current directory: `C:\Users\adhit\EmoryHacksDevEnvironment\moltivate`.
  Native shell is Windows PowerShell on Windows 11 Home, x64.
- Checkout is `main`, at `d998294` when inspected, tracking `origin/main`.
  Remote: `https://github.com/betrji/moltivate`.
- **`git stash list` is empty.** The oracle/backend stash described below did
  not transfer to this clone. Do not run the old `git stash pop` instructions
  or assume that work/secrets are present. Recovery requires the old machine
  or another copy; do not recreate financial/backend behavior as an environment
  fix.
- The remote-tracking branch `origin/stephen/wire-frontend-to-anchor-program`
  exists. Live `gh pr view 16 --repo betrji/moltivate` confirmed PR #16 is still
  OPEN and unmerged. No fetch, checkout, merge, commit, or push was performed.
- Native Git is 2.49.0; GitHub CLI is 2.104.0. GitHub authentication works as
  **betrji**, which differs from the earlier handoff's user/account assumption.
  Do not print authentication tokens. Git has `core.autocrlf=true` and
  `core.symlinks=false`. No tracked gitlinks were found.
- Root `AGENTS.md`, `readme.md`, `architecture.md`, and `apps/app/AGENTS.md`
  were read. Several older status descriptions are stale relative to the
  committed Anchor implementation; distinguish source inspection from tests
  actually rerun here.

### Node and dependency setup

- System Node is **22.13.1**, npm **10.9.2**. Root `.node-version` requires
  **24.22.1** and root `package.json` requires Node >=24 <25.
- Downloaded Node **24.22.1** Windows x64 from nodejs.org into
  `.local-tools/node-v24.22.1-win-x64/`. The download command verified its ZIP
  against the official `SHASUMS256.txt` before extraction. A subsequent direct
  invocation of its `node.exe --version` confirmed `v24.22.1`.
- System Node/PATH were not modified. For each PowerShell tool call that needs
  the local version, prepend it explicitly:

  ```powershell
  $env:PATH = "$PWD\.local-tools\node-v24.22.1-win-x64;$env:PATH"
  node --version
  npm --version
  ```

  Run that from the repository root before changing to a package directory.
- `.gitignore` has one uncommitted addition: `.local-tools/`, to keep the
  downloaded runtime/archive/checksums and diagnostic script out of source.
  Preserve it. No lockfiles or package manifests were changed.
- At handoff, **none** of root `node_modules`, `apps/app/node_modules`, or
  `programs/commitment-stakes/node_modules` exists. A proposed root `npm ci`
  tool call was interrupted; do not assume it executed. All three package
  roots have committed npm lockfiles. Install from those locks, avoiding
  dependency upgrades during setup. Browser binaries are not yet verified.

### WSL / Rust / Solana

- WSL2 has `Ubuntu` and `docker-desktop`; explicitly use `wsl -d Ubuntu`
  because Docker's distribution is the default. Ubuntu starts successfully
  despite a warning about nested virtualization detection
  (`ERROR_INVALID_DATA`). Do not treat that warning alone as failure.
- Ubuntu is **26.04.1 LTS**, x86_64, user `adhit`. At inspection it had about
  12 GiB available memory, 4 GiB swap, and 950 GiB free in its filesystem;
  Windows had 10.56 GiB free physical RAM and about 381 GiB disk space.
- Existing installations were found under `/home/adhit/.cargo/bin`,
  `/home/adhit/.avm/bin`, and
  `/home/adhit/.local/share/solana/install/active_release/bin`. The host Rust
  executable reports **rustc 1.100.0**. AVM has an `anchor-0.32.1` executable.
  Solana executables and a `~/.cache/solana/v1.51.1` directory exist, but their
  versions and usability have **not** been established.
- A non-login Bash invocation lacks Cargo/AVM/Solana on PATH and has no Linux
  Node. It finds Windows npm through the inherited Windows PATH. Ensure
  validator tests use Linux Node/npm and Linux dependencies, not Windows npm
  or Windows-installed native packages.
- `~/.profile` sources `~/.cargo/env` and adds Solana to PATH; `~/.bashrc`
  returns early for noninteractive shells. Verify login-shell behavior and AVM
  selection before concluding installations are broken. An absolute-path
  Anchor invocation without Rust on PATH failed with
  `listing linked Rust toolchains / No such file or directory`.
- `.local-tools/inspect-wsl.sh` is a throwaway diagnostic script written by
  PowerShell with **CRLF**. Its final `solana --version` failed because Bash
  passed `--version\r`. Rewrite any shell scripts with LF before using them;
  this error does not establish that Solana itself is broken. Windows native
  argument quoting also mangled an earlier complex inline `bash -c` command;
  prefer LF script files and simple WSL invocations.
- Repository pins Anchor **0.32.1** and documents Solana **2.3.0**. The old
  machine's platform-tools symlink workaround did not transfer. Verify SBF
  compiler compatibility explicitly; do not assume host rustc is the SBF
  compiler or blindly alter caches.
- `Anchor.toml` expects `~/.config/solana/devnet-throwaway.json`; existence,
  identity and funding have not been checked. Deployment keypairs did not
  transfer with Git. Never overwrite existing keys or change program IDs as
  a setup shortcut. Do not deploy or transact as part of this audit.

### Configuration, permissions, and next actions

- Root `.env`, root `.env.local`, and `apps/app/.env.local` are absent.
  `apps/app/.env.example` on main has devnet defaults and empty Supabase keys;
  it does not contain the stashed oracle additions. The old oracle secret and
  the old `C:\Users\steph\...\slack-agent\.env` are not available here.
  Do not fabricate credentials, print secrets, or apply database migrations.
- No listeners on ports 3000, 4173, 5173, 8899, or 8900 were returned by the
  initial native check; recheck before starting servers.
- The previous session used workspace-write restrictions. WSL inspection and
  GitHub/network operations needed escalation; sandbox `Access denied` did
  not mean WSL was absent. An approval prefix for `wsl -d Ubuntu` was granted,
  but permissions may differ in the new conversation. Respect its actual
  policy. The user plans to select automatic approval review in the new app.
- Next: verify local Node/npm; install locked dependencies; verify WSL login
  PATH, Linux Node, Anchor/Solana versions, required build tools and SBF
  compilation. Keep OS-specific dependencies separate. Then run root static
  checks/build/browser suite, app lint/build, and appropriate local contract
  checks, reporting exactly what passes and what remains blocked. App builds
  may need network access for `next/font/google`. No setup checks have passed
  yet beyond the version/access checks listed above.
- Only after environment readiness is established should the next agent
  resume product work and determine how to recover the missing oracle stash.

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

## Historical next steps from the old machine

This checklist records the old session. Use **Resume here** for the current plan.

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
