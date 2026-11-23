# Accounts and Wallet Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require an email/password account on every device, let an account link several wallets by signed proof, and make workouts and challenge closing authorized by the account instead of wallet signatures.

**Architecture:** Supabase Auth (cookie sessions through `@supabase/ssr`) authenticates people. New tables `profiles`, `linked_wallets`, `wallet_link_nonces` record who owns which wallet; the server checks `memberAcc.owner` on chain against the account's linked wallets. `proxy.ts` gates pages; each API route calls one shared `requireAccount()` that also enforces verified email, 2FA level and a same-origin check. On-chain actions are still signed by the user's own wallet.

**Tech Stack:** Next.js 16 (App Router, Cache Components), React 19, `@supabase/ssr` + `@supabase/supabase-js`, `tweetnacl`, `@solana/web3.js`, Anchor client, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-accounts-and-wallet-linking-design.md` (read it first). Project 2 (phone signing through Phantom deep links) is out of scope.

## Global Constraints

- **Read the bundled Next docs first.** `apps/app/AGENTS.md`: "This is NOT the Next.js you know". Before touching `proxy.ts`, cookies or auth, read `apps/app/node_modules/next/dist/docs/01-app/02-guides/16-proxy.md`, `authentication.md` and `authentication-with-cache-components.md`. `next.config.ts` has `cacheComponents: true`.
- Devnet only. Never print, log or commit a secret; the service-role key stays server-only; keep `apps/app/.env.example` redacted and in sync. No `NEXT_PUBLIC_*` variable may hold a secret (the Supabase publishable key is public by design).
- Do not change the Anchor program, the IDL, settlement rules, payout logic or trust tiers. Client-counted reps stay `trust_level: 'unverified'`.
- No dependency on infrastructure Stephen doesn't own; no third-party auth service beyond his Supabase project. Pin any new dependency exactly and record why in the commit message.
- Anything an account login can do must never move funds. Only a wallet signature does.
- Never reveal whether an email is registered; never return or log an email, password, token or session from a public API.
- No secrets in git; never stage `.env*`. Check `git diff --cached --summary` for mode 160000 before each commit. Do not push or deploy; Stephen decides.
- Tests: `cd apps/app && node --test tests/<file>.test.mjs`; follow the `load()` transpile+vm harness with stubbed requires in `tests/challenges-close.test.mjs`. Each task ends with `npm run lint` (in `apps/app`) clean. `npm run build` must pass **with no env vars set** (CI builds that way), so create Supabase clients lazily, never at import time.
- Commit messages end with the attribution trailers given for this session.
- Describe only what was run. Mocked tests do not establish real Supabase email, real Phantom or real phone behaviour; say so in docs and reports.

## Review Focus

Failure modes the spec implies that most need a pinned test, most likely first:

1. **Two accounts race to link one wallet.** Exactly one wins; the loser gets a generic conflict that doesn't say who owns it (Task 2 SQL function, Task 4 route test).
2. **A link signature replayed** as an unlink, for another account, another wallet, a used nonce or an expired nonce is rejected (Tasks 1 and 4).
3. **Cross-site POST with a valid cookie** (wrong or missing `Origin`) is refused by every cookie-authenticated mutating route (Tasks 3, 4, 5, 6, 7).
4. **A wallet unlinked mid-session** can no longer submit workouts: the linked set is read on every request, never cached (Task 6).
5. **An account with verified 2FA but only a password-level session** is refused by the API, not just by the login screen (Task 3).

---

### Task 1: Pure shared helpers

**Files:**
- Create: `apps/app/lib/wallet-link-message.ts`, `apps/app/lib/display-name.ts`, `apps/app/lib/same-origin.ts`, `apps/app/lib/safe-next-path.ts`
- Test: `apps/app/tests/account-helpers.test.mjs`

**Interfaces:**
- Produces:
  - `type WalletProof = { accountId: string; wallet: string; nonce: string; expiresAt: number }` (unix seconds)
  - `linkWalletMessage(p: WalletProof): string`, `unlinkWalletMessage(p: WalletProof): string`. Both start `Moltivate:`, list Account, Wallet, Nonce and an ISO `Expires` line, and differ in their first line (link vs unlink) so a signature for one can't verify for the other.
  - `normalizeDisplayName(raw: string): { ok: true; name: string; key: string } | { ok: false; error: string }`
  - `isSameOrigin(originHeader: string | null, requestUrl: string): boolean`
  - `safeNextPath(raw: string | null | undefined): string` (returns `"/"` unless `raw` is a single-slash relative path)

- [ ] **Step 1: Write failing tests** in `account-helpers.test.mjs`:
  - link and unlink messages for the same proof are different strings; each contains the account id, wallet, nonce and the ISO expiry.
  - `normalizeDisplayName`: `"  Ada   Lovelace "` → name `"Ada Lovelace"`, key `"ada lovelace"`; full-width `"ＡＤＡ"` (NFKC) → key `"ada"`; rejects `""`, 41 chars, control characters, `"<script>"`, a leading space-only name, and `"-x"`; accepts `"Ada_L-1.2"`. Allowed pattern after trimming, collapsing spaces and NFKC: `^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$`.
  - `isSameOrigin`: `("https://a.app", "https://a.app/api/x")` true; `("https://evil.app", ...)` false; `(null, ...)` false; `("https://a.app.evil.com", ...)` false.
  - `safeNextPath`: `"/challenges/x?y=1"` kept; `"//evil.com"`, `"https://evil.com"`, `"/\\evil.com"`, `""`, `null` → `"/"`.
- [ ] **Step 2:** Run `node --test tests/account-helpers.test.mjs`. Expected: FAIL, modules not found.
- [ ] **Step 3:** Implement the four files per the signatures above. Keep them dependency-free (they are shared by client and server).
- [ ] **Step 4:** Run the test. Expected: PASS. Run `npm run lint`.
- [ ] **Step 5:** Commit `feat: pure helpers for wallet-link messages, display names, origin and next-path checks`.

---

### Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20261123010000_accounts.sql`
- Test: `apps/app/tests/accounts-migration.test.mjs`

**Interfaces:**
- Produces tables (all with RLS enabled and no policies, matching `20261120010000_enable_rls.sql`):
  - `profiles(user_id uuid pk references auth.users(id) on delete cascade, display_name text not null check (char_length(display_name) between 1 and 40), display_name_key text not null unique, created_at timestamptz default now())`
  - `linked_wallets(wallet_address text primary key check (char_length(wallet_address) between 32 and 44), user_id uuid not null references auth.users(id) on delete cascade, linked_at timestamptz default now())` plus an index on `user_id`
  - `wallet_link_nonces(nonce text primary key, user_id uuid not null references auth.users(id) on delete cascade, wallet_address text not null, purpose text not null check (purpose in ('link','unlink')), expires_at timestamptz not null, used_at timestamptz)`
  - `alter table workout_sessions add column account_id uuid references auth.users(id)`
  - `drop table users` only after confirming nothing references it (`grep -rn "references users" supabase/migrations` and the app has no remaining reader after Task 5; if `challenges.creator_id` references it, drop that constraint's table chain too, or leave `users` in place and say so in the commit).
  - `link_wallet(p_nonce text, p_user uuid, p_wallet text) returns text` → `'linked' | 'bad_nonce' | 'taken'`. In one transaction: lock the nonce row (`for update`), require `purpose='link'`, same user and wallet, `used_at is null`, `expires_at > now()`; insert into `linked_wallets` (unique violation → `'taken'`, nonce left unused); set `used_at`.
  - `unlink_wallet(p_nonce text, p_user uuid, p_wallet text) returns text` → `'unlinked' | 'bad_nonce' | 'not_linked'` with the same nonce rules (`purpose='unlink'`).
  - Both functions: `security definer`, `set search_path = public`, `revoke all ... from public, anon, authenticated; grant execute ... to service_role`. (Functions in `public` are callable by the anon key through RPC unless revoked.)

- [ ] **Step 1: Write failing guard test** (reads the SQL as text): every new table has an `enable row level security` statement; `linked_wallets.wallet_address` is the primary key; `display_name_key` is unique; both functions contain `revoke` from `anon` and `grant execute ... to service_role`; no `create policy`.
- [ ] **Step 2:** Run it. Expected: FAIL (file missing).
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run the guard test. Expected: PASS. Note in the commit that the SQL has **not** been executed against a database; Stephen applies it (see Task 12).
- [ ] **Step 5:** Commit `feat: accounts schema (profiles, linked wallets, link nonces)`.

---

### Task 3: Auth plumbing and `requireAccount`

**Files:**
- Modify: `apps/app/package.json`, lockfile, `apps/app/.env.example`, `apps/app/lib/supabase-key.ts`
- Create: `apps/app/lib/supabase-auth.ts`, `apps/app/lib/supabase-browser.ts`, `apps/app/lib/account-auth.ts`, `apps/app/lib/linked-wallets.ts`
- Test: `apps/app/tests/account-auth.test.mjs`, extend `apps/app/tests/supabase-key.test.mjs`

**Interfaces:**
- Consumes: `isSameOrigin` (Task 1), `getSupabaseServerClient` (existing, service role).
- Produces:
  - env var `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (add to `.env.example`, empty).
  - `assertPublishableKey(key: string): void` in `supabase-key.ts`: accepts `sb_publishable_` keys and anon-role JWTs, throws (never echoing the key) on `sb_secret_` keys and service_role JWTs.
  - `createAuthClient(request: Request): SupabaseClient` in `supabase-auth.ts`: `createServerClient` from `@supabase/ssr`, cookies read from the request's `Cookie` header, `setAll` a no-op (the proxy refreshes sessions). Calls `assertPublishableKey`.
  - `createBrowserAuthClient(): SupabaseClient` in `supabase-browser.ts` (lazy singleton).
  - `type Account = { userId: string; email: string }`
  - `requireAccount(request: Request): Promise<{ ok: true; account: Account } | { ok: false; response: Response }>` in `account-auth.ts`. Order: (1) for methods other than GET/HEAD, wrong/missing `Origin` → 403 `{error:"cross-origin request refused"}`, non-JSON content type → 415; (2) `auth.getUser()` (server-verified, not a decoded JWT); none → 401 `{error:"not signed in"}`; (3) `email_confirmed_at` null → 403 `{error:"verify your email first"}`; (4) if `auth.mfa.getAuthenticatorAssuranceLevel()` shows `nextLevel === 'aal2'` and `currentLevel !== 'aal2'` → 401 `{error:"two-step verification required"}`.
  - `getLinkedWallets(userId: string): Promise<string[]>` in `linked-wallets.ts` (service client, no caching).

- [ ] **Step 1:** `npm view @supabase/ssr version` and `npm install --save-exact @supabase/ssr@<latest at least 2 weeks old>`; commit message states why (cookie-based session handling for Next).
- [ ] **Step 2: Write failing tests.** `supabase-key.test.mjs`: `assertPublishableKey` accepts `sb_publishable_abc` and an anon JWT; rejects `sb_secret_x` and a service_role JWT; error never contains the key. `account-auth.test.mjs` (stub `@supabase/ssr` and `./supabase-auth`): GET with no session → 401; POST with a valid session but `Origin: https://evil.app` → 403; POST with no Origin → 403; POST with `content-type: text/plain` → 415; unconfirmed email → 403; AAL1 session with `nextLevel: 'aal2'` → 401 "two-step verification required"; AAL1 with `nextLevel: 'aal1'` → ok; verified aal2 → ok with `account.userId` and `email`.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement per the interfaces. `.env.example`: add the publishable-key line with a comment that it is public by design and must be the anon/publishable key, never the service-role key.
- [ ] **Step 5:** Run tests, `npm run lint`, and `npm run build` with no env vars. Expected: all green.
- [ ] **Step 6:** Commit `feat: cookie-session auth plumbing and requireAccount`.

---

### Task 4: Wallet link and unlink API

**Files:**
- Create: `apps/app/app/api/wallet-links/nonce/route.ts`, `apps/app/app/api/wallet-links/link/route.ts`, `apps/app/app/api/wallet-links/unlink/route.ts`, `apps/app/lib/open-stakes.ts`
- Test: `apps/app/tests/wallet-link.test.mjs`, `apps/app/tests/open-stakes.test.mjs`

**Interfaces:**
- Consumes: `requireAccount`, `getLinkedWallets`, `linkWalletMessage`/`unlinkWalletMessage`, `getReadOnlyProgram` and `fetchMemberships` (existing), SQL functions from Task 2.
- Produces:
  - `POST /api/wallet-links/nonce` body `{ wallet: string, purpose: "link" | "unlink" }` → `{ nonce, expiresAt, message }`. The server builds `message` (so the client signs exactly what the server verifies). Nonce is 32 random bytes, base64url; lifetime 5 minutes. Refuses with 429 when the account already has 10 unused unexpired nonces.
  - `POST /api/wallet-links/link` body `{ wallet, nonce, signature }` (signature base64) → 200 `{ wallet }`; 400 invalid or expired/used nonce; 401 signature mismatch; 409 `{error:"this wallet can't be linked to your account"}` when taken.
  - `POST /api/wallet-links/unlink` body `{ wallet, nonce, signature, password }`; the server re-checks the password with a throwaway anon client (`persistSession: false`) calling `signInWithPassword` for the account's email, never touching the cookie session; wrong password → 401. Blocked with 409 `{error:"this wallet still has an open stake or an unclaimed payout"}` per `hasOpenStake`.
  - `hasOpenStake(program: Program<CommitmentStakes>, wallet: PublicKey): Promise<boolean>`: true if any membership of `wallet` belongs to an unsettled challenge, or a settled one with `claimed === false`. Built on `fetchMemberships` and `program.account.challenge.fetchMultiple`.

- [ ] **Step 1: Write failing tests** (real `tweetnacl` and `web3.js` keys as in `workout-sessions.test.mjs`; stub `requireAccount`, the service client RPC, and the program):
  - nonce route: valid → message equals `linkWalletMessage` for the returned fields; invalid purpose → 400; wrong Origin → 403 (via `requireAccount`); 11th outstanding nonce → 429.
  - link route: valid signature → 200 and `link_wallet` called with (nonce, userId, wallet); signature by a different key → 401 and no RPC call; signature made over the **unlink** message → 401; message for a different account id → 401; RPC returns `bad_nonce` → 400; `taken` → 409 with the generic text that does not contain the other account's id; malformed base64 → 400.
  - unlink route: wrong password → 401, no RPC; `hasOpenStake` true → 409, no RPC; wallet signature over the **link** message → 401; success calls `unlink_wallet`.
  - `open-stakes.test.mjs`: no memberships → false; unsettled challenge → true; settled with unclaimed member → true; settled and claimed → false.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Verify signatures with `nacl.sign.detached.verify` inside try/catch (malformed input is 400, as in the existing routes).
- [ ] **Step 4:** Run the tests and lint. Expected: PASS.
- [ ] **Step 5:** Commit `feat: signed wallet linking and unlinking`.

---

### Task 5: Profile and display-name API

**Files:**
- Create: `apps/app/lib/profile.ts`, `apps/app/app/api/me/route.ts`, `apps/app/app/api/profile/route.ts`, `apps/app/app/api/profile/name-available/route.ts`
- Modify: `apps/app/app/api/users/route.ts`
- Test: `apps/app/tests/profile.test.mjs`

**Interfaces:**
- Consumes: `normalizeDisplayName`, `requireAccount`, `getLinkedWallets`.
- Produces:
  - `ensureProfile(userId: string, metadataName: unknown): Promise<{ displayName: string | null }>` in `lib/profile.ts`: returns the existing profile; otherwise tries to create one from the sign-up metadata name **after** passing it through `normalizeDisplayName` (metadata is untrusted: anyone can call Supabase's public sign-up with any metadata); an invalid or taken name yields `{ displayName: null }`.
  - `GET /api/me` (account required) → `{ email, displayName: string | null, needsDisplayName: boolean, wallets: string[] }`; logged out → 401.
  - `POST /api/profile` body `{ displayName }`: sets or renames the account's name; 400 invalid, 409 taken.
  - `GET /api/profile/name-available?name=` (public) → `{ available: boolean, error?: string }`.
  - `GET /api/users?wallets=a,b` unchanged response shape `{ names: { [wallet]: displayName } }`, now resolved through `linked_wallets` then `profiles`; returns names only. The `POST` handler is removed.

- [ ] **Step 1: Write failing tests** (stub the service client): `ensureProfile` creates from a valid metadata name; `<script>` metadata → `null` and no insert; unique violation → `null`; `GET /api/me` for an account with two linked wallets returns both; `POST /api/profile` with a wrong Origin → 403, a taken name → 409, `"  Ada "` stores name `"Ada"` and key `"ada"`; name-available true/false; `GET /api/users` maps two wallets of one account to the same name and omits unlinked wallets; `POST /api/users` is gone (no `POST` export).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Leave `lib/display-name-message.ts` and the old editor alone until Task 9 deletes them, so the build stays green.
- [ ] **Step 4:** Tests and lint pass.
- [ ] **Step 5:** Commit `feat: account display names resolve wallets to people`.

---

### Task 6: Workout API authorized by the account

**Files:**
- Modify: `apps/app/app/api/workout-sessions/route.ts`, `apps/app/app/components/mediapipe-squat-session.tsx`
- Delete: `apps/app/lib/workout-auth.ts`
- Rewrite: `apps/app/tests/workout-sessions.test.mjs`

**Interfaces:**
- Consumes: `requireAccount`, `getLinkedWallets`.
- Produces: `POST /api/workout-sessions` body `{ challengePubkey, teamMemberPubkey, idempotencyKey, reps, source: "browser_mediapipe" }`. Removed fields: wallet, sessionKey, authSignature, signature, expiresAt. Validation, deadline, membership, idempotency and `unverified` behaviour are unchanged. New rule: after fetching the member account, `memberAcc.owner` must be in `getLinkedWallets(account.userId)` (called on every request) else 403. The inserted row records `account_id`.

- [ ] **Step 1: Rewrite the tests first** (keep the existing cases for validation, deadline, idempotency, wrong-challenge member and `unverified`; drop the session-key cases) and add: no session → 401; wrong Origin → 403; member owned by a wallet **not** in the account's linked set → 403 and no insert; **linked set emptied between two calls** → first 200, second 403 (Review Focus 4); inserted row contains `account_id` equal to the account's user id.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Update the route; delete `workout-auth.ts`. In the squat component remove `authorizeSession`, the `"authorizing"` phase, the session ref, the nacl/wallet imports and the Phantom message; `start()` goes straight to loading the camera. On 401 from the API show "Sign in again to save this set." and keep the count.
- [ ] **Step 4:** Tests, lint and `npm run build` pass.
- [ ] **Step 5:** Commit `feat: workouts are authorized by the logged-in account`.

---

### Task 7: Close-challenge API authorized by the account

**Files:**
- Modify: `apps/app/app/api/challenges/close/route.ts`, `apps/app/app/challenges/[id]/results/client.tsx`
- Delete: `apps/app/lib/close-challenge-message.ts`
- Rewrite: `apps/app/tests/challenges-close.test.mjs`

**Interfaces:**
- Produces: `POST /api/challenges/close` body `{ challengePubkey }`. `GET` (batch lookup) stays public and unchanged. The "settled, has members, every member claimed" gates stay. Authorization: some linked wallet of the account equals `challengeAcc.creator` or a member `owner`; else 403. `closed_by` records the wallet that qualified.

- [ ] **Step 1: Rewrite tests:** creator account closes; member account closes; account with no linked creator/member wallet → 403; not signed in → 401; wrong Origin → 403; the existing claim gate and not-settled cases still return 400.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; in `results/client.tsx` remove `signMessage` and the signature step from `handleClose` (it just POSTs `{ challengePubkey: id }`).
- [ ] **Step 4:** Tests, lint, build pass.
- [ ] **Step 5:** Commit `feat: closing a challenge uses the account instead of a wallet signature`.

---

### Task 8: Sign-in pages, session gate and account provider

**Files:**
- Create: `apps/app/proxy.ts`, `apps/app/app/login/page.tsx`, `apps/app/app/signup/page.tsx`, `apps/app/app/forgot-password/page.tsx`, `apps/app/app/reset-password/page.tsx`, `apps/app/app/welcome/page.tsx`, `apps/app/app/auth/callback/route.ts`, `apps/app/app/components/account-provider.tsx`
- Modify: `apps/app/app/layout.tsx`, `apps/app/app/components/nav.tsx`, `apps/app/app/globals.css` (reuse existing `.app-page`, `.form-page`, `.input`, `.button-primary` styles)

**Interfaces:**
- Consumes: `createBrowserAuthClient`, `safeNextPath`, `normalizeDisplayName`, `GET /api/me`, `/api/profile/name-available`.
- Produces:
  - `proxy.ts`: refreshes the Supabase session cookie, then for a request with no signed-in user redirects pages to `/login?next=<safeNextPath>`. Public paths: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/*`, `/join/*` (invite preview), static assets, manifest, icons. Its matcher excludes `/api/*` (API routes answer 401 JSON themselves).
  - `AccountProvider` and `useAccount(): { status: "loading" | "signedOut" | "signedIn"; me: Me | null; refresh(): Promise<void> }` where `Me` is the `/api/me` body. Mounted in `layout.tsx` inside `Providers`; a 401 yields `signedOut`.
  - Login supports password sign-in then, if the account has a verified TOTP factor, a code step (`mfa.challenge` + `mfa.verify`) before leaving the page. Sign-up collects email, password (min length 12), display name; it calls name-available first, then `auth.signUp` with `options.data.display_name` and `emailRedirectTo` = `/auth/callback`; it always shows "Check your email" without saying whether the address already exists. Forgot/reset use `resetPasswordForEmail` and `updateUser`. `/welcome` asks for a display name when `needsDisplayName` is true; `AccountProvider` sends a signed-in account with `needsDisplayName` there.
  - `auth/callback/route.ts` exchanges the code for a session and redirects to `safeNextPath(next)`.
  - Nav: signed-out shows only the wordmark and "Log in"; signed-in shows the display name linking to `/account`.

- [ ] **Step 1: Write failing tests** for the pieces that run without Supabase: a unit test of the proxy's path rules, loaded through the transpile+vm harness (signed-out `/` → redirect to `/login?next=%2F`; `/join/abc` → pass; `/api/me` → not matched; `/login?next=//evil.com` produces a redirect that ignores the unsafe next; `/auth/callback` → pass).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement proxy and pages following the Next docs read at the start. Keep every Supabase client lazy so `npm run build` works without env vars.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npm run build` (no env). Expected: green. Start the dev server with real env and check `/` redirects to `/login` when logged out; record what was and wasn't run.
- [ ] **Step 5:** Commit `feat: login, signup, password reset, session gate and account provider`.

---

### Task 9: Account page

**Files:**
- Create: `apps/app/app/account/page.tsx`, `apps/app/app/account/account-client.tsx`
- Delete: `apps/app/app/components/display-name-editor.tsx`, `apps/app/lib/display-name-message.ts`; remove the editor from `apps/app/app/page.tsx`

**Interfaces:**
- Consumes: `useAccount`, `POST /api/wallet-links/nonce|link|unlink`, `POST /api/profile`, `useWallet` (for `signMessage` and the connected key).
- Produces: a page showing email, display name with rename, the linked wallets (address, unlink with password prompt and wallet signature), a "Link connected wallet" button (nonce → `signMessage` of the server's `message` → link; when no wallet is connected on desktop it shows `WalletButton`, on a phone it explains linking needs a desktop browser), change password (`auth.updateUser`), optional authenticator-app setup (`mfa.enroll` shows the QR/secret, `mfa.challenge` + `mfa.verify` confirms; offered once after first sign-in), "Log out" and "Log out of all devices" (`signOut({ scope: "global" })`). After link or unlink, `refresh()` and dispatch `moltivate:updated`.

- [ ] **Step 1:** Write the page and client component; reuse existing form styles. No new unit test (UI); the Task 11 smoke covers it.
- [ ] **Step 2:** `npm run lint` and `npm run build` (no env). Expected: green.
- [ ] **Step 3:** Commit `feat: account page for wallets, password, 2FA and sign-out`.

---

### Task 10: Linked-wallet-aware app

**Files:**
- Modify: `apps/app/app/components/current-challenge-link.tsx`, `apps/app/app/components/wallet-button.tsx`, `apps/app/app/join/[code]/join-client.tsx`, `apps/app/app/challenges/new/page.tsx`, `apps/app/app/components/claim-button.tsx`, `apps/app/app/challenges/[id]/results/client.tsx`
- Create: `apps/app/app/components/linked-wallet-gate.tsx`
- Test: extend `apps/app/tests/challenge-discovery.test.mjs`

**Interfaces:**
- Consumes: `useAccount`, `getReadProgram`, `fetchWalletChallenges(program, owner)` (accepts a wallet-less program).
- Produces:
  - `CurrentChallengeLink` loads challenges for **every** linked wallet with `getReadProgram(connection)` and merges them by challenge id (a challenge both wallets belong to appears once; "Created by you" if any linked wallet is creator; claim pending if any is). It needs no connected wallet.
  - `LinkedWalletGate({ children })`: if signed in and a wallet is connected but not in `me.wallets`, renders "This wallet isn't linked to your account" with a link to `/account`; if no wallet is connected, renders the connect prompt; otherwise `children`. Wrap the signing actions (join deposit, create form, claim button, close button).
  - Join page: for a signed-out visitor show the challenge preview with "Log in or sign up to join" (links carry `?next=/join/<code>`); the join page no longer needs `useWallet().connected` for the preview.
  - `WalletButton` on a phone: replace the "iPhone wallet support is still being tested" copy with "On a phone you can view your challenges and record workouts. Deposits and claims need a desktop browser with Phantom for now."

- [ ] **Step 1: Write failing test** in `challenge-discovery.test.mjs` for the merge helper (extract `mergeWalletChallenges(lists: Challenge[][]): Challenge[]` into `lib/anchor.ts`): duplicate id across two wallets appears once; `creator` true if either; `claimPending` true if either; settled preserved.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the helper, the gate and the component changes.
- [ ] **Step 4:** `npm test`, lint, build pass.
- [ ] **Step 5:** Commit `feat: challenges and actions follow the account's linked wallets`.

---

### Task 11: Smoke test with a fake Supabase

**Files:**
- Create: `apps/app/tests/fake-supabase.mjs`
- Modify: `apps/app/tests/ui-smoke.mjs`

**Interfaces:**
- Produces: `startFakeSupabase(port): Promise<{ close(): void }>`, a small node `http` server answering only what the app calls server-side: `GET /auth/v1/user` (returns a verified user for the smoke session's bearer token, none otherwise), the PostgREST reads for `linked_wallets` and `profiles`, the `rpc/link_wallet` call, and `workout_sessions` inserts. Everything else returns 404 so a missing mock fails loudly. Server-side fetches can't be intercepted by Playwright routes, which is why this is a real HTTP server; build and start the app with `NEXT_PUBLIC_SUPABASE_URL` pointing at it (the value is inlined at build time) and set the session cookie in the Playwright context.

- [ ] **Step 1:** Extend the smoke test, run against the old build first to see the new checks fail, then pass: signed-out visit to `/` ends at `/login`; `/join/<expired>` stays viewable signed-out with "Log in or sign up to join"; a signed-in session lists the challenge for a **linked** wallet with no wallet connected; connecting an **unlinked** wallet on the join page shows "isn't linked"; the account page lists linked wallets; the existing late-deposit and late-create checks still pass with a linked mock wallet; `signMessage` is no longer called by the squat start path.
- [ ] **Step 2:** Run per the repo's routine: kill port 13000, `npm run build`, start on 13000, `node tests/ui-smoke.mjs`; then root `npm run ci`. Expected: PASS.
- [ ] **Step 3:** Commit `test: UI smoke covers login gate, invite preview and linked wallets`.

---

### Task 12: Documentation and handoff

**Files:**
- Modify: `AGENTS.md`, `readme.md`, `apps/app/DEPLOYMENT.md`, `docs/APP_DESIGN.md`, `apps/app/.env.example`

- [ ] **Step 1:** Update the known-gaps bullet (workouts are authorized by the logged-in account whose linked wallet owns the member account; this stops other people submitting for you, not you faking your own reps); the stack table (Supabase Auth); the wallet row (phone can view and record workouts, signing needs desktop until project 2).
- [ ] **Step 2:** Add to `DEPLOYMENT.md` the dashboard steps Stephen must do: apply `20261123010000_accounts.sql`; require email confirmation; set the site URL and redirect allow-list for production and Vercel previews; enable TOTP MFA; configure custom SMTP before real sign-ups; set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel. State clearly that none of these were run by the agent.
- [ ] **Step 3:** Run root `npm run ci`, `apps/app` lint/test/build. Commit `docs: accounts, linked wallets and setup steps`.
- [ ] **Step 4:** Final report lists what was run, what was mocked, and the real-device and real-Supabase checks Stephen still owes: sign-up email delivery, login and 2FA, link and unlink with real Phantom, workout from a phone, invite preview while signed out.
