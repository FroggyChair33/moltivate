# Accounts and wallet linking: design

Status: draft for Stephen's approval. Date: 2026-11-23.
Scope: **project 1 of 2.** Project 2 (signing deposits, creates and claims on a
phone through Phantom deep links) gets its own design after this ships.

## Intent and why

Today a person's identity in Moltivate is a connected wallet. Wallet connect
only works in a desktop or laptop browser (Phantom's extension), so someone who
connects on desktop has no way to carry that over to the phone or the installed
PWA. Stephen wants the phone to do as much as the desktop, so users don't need a
computer nearby.

The fix is a classic account (email and password, display name) that owns one or
more linked wallets. The account is what follows a person between devices. The
wallet stays what it is on-chain: the thing that holds stakes and signs
transactions.

## Goals

- Sign up, log in and log out with email and password on desktop and phone.
- An account is **required** to use the app on every device.
- A display name set at sign-up belongs to the account and is shown wherever the
  app shows a wallet's owner.
- One account can link several wallet addresses (including several Phantom
  accounts from one seed phrase; the app only sees addresses).
- A logged-in phone can see the user's challenges, scoreboards and results, and
  can run workout sessions, with no wallet connection on the phone.
- Strong security: verified email, optional 2FA, signed wallet-ownership proofs,
  CSRF protection, no account enumeration, no email leakage.

## Non-goals (this project)

- Signing transactions on a phone (deposit, create, claim). That is project 2.
  Until it ships, those actions still need desktop with the wallet extension.
- Social login, passkeys, account deletion, email-change flow.
- Any change to the on-chain program, IDL, settlement rules, payout logic or
  trust tiers. Client-counted reps stay `unverified`.
- Fixing the open `/api/oracle/settle` trigger.

## Anti-goals (a failure even if it technically works)

- Any path where an account login alone moves funds. Only a wallet signature
  does that.
- Custody of keys, seed phrases or private keys, by us or a third party.
- Two accounts controlling the same wallet address.
- Revealing whether an email is registered, or exposing any email publicly.

## Constraints

- Follows AGENTS.md: devnet only, secrets never printed or committed,
  service-role key server-only, `.env.example` kept in sync, no unrequested push
  or deploy, no dependency on infrastructure Stephen doesn't own.
- Auth provider is Supabase Auth in Stephen's existing Supabase project. No new
  third-party service.
- Supabase's built-in email sender is heavily rate-limited; real sign-ups need
  custom SMTP (Stephen sets it up). Preview deployments need their URLs on the
  Supabase redirect allow-list.
- Existing test accounts and data may be deleted. No migration path is needed.

## Approaches considered

- **A. Account plus linked wallets; phone signs through Phantom deep links
  (chosen).** Non-custodial, matches the project rules. The phone-signing round
  trip is hard and is deferred to project 2.
- **B. Account with an embedded wallet.** Closest to "email is the wallet" and
  the phone just works, but a third party holds or splits the keys. That breaks
  the non-custodial claim and AGENTS.md. Rejected.
- **C. Delivery order of A:** accounts first, phone signing second. Adopted as
  how A is shipped.

## Decisions (Stephen's unless marked "my call")

- Account required everywhere; wallet-only mode removed.
- One account to many wallets. One wallet address to at most one account.
- Workouts are authorized by the logged-in account, not a per-visit wallet
  signature. The server still requires that a linked wallet is the on-chain
  `memberAcc.owner`. The session-key code (`lib/workout-auth.ts`, the signature
  prompt before the camera) is removed.
- Display name belongs to the account, set at sign-up.
- Display names are unique, compared case-insensitively. *My call.*
- 2FA (authenticator-app TOTP) is optional, offered after sign-up. *My call.*
- Closing a challenge also switches from a wallet signature to account plus
  linked-wallet check (creator or member). It moves no funds. *My call.*
- Linking message names the account ID, not the display name, so renaming never
  invalidates a link. *My call.*

## Design

### Identity and sessions

- Supabase Auth, email and password, **email verification required** before the
  account can link wallets or do anything else.
- Sessions in `httpOnly`, `Secure`, `SameSite=Lax` cookies (via `@supabase/ssr`).
  Server routes call `auth.getUser()`, which checks with the Auth server; they
  never trust a decoded JWT alone.
- A `proxy.ts` refreshes sessions and redirects logged-out users to `/login`.
  Public: `/login`, `/signup`, password reset, auth callback, static assets, and
  an **invite preview** at `/join/[code]` (challenge details are public
  on-chain; joining needs login).
- Log out, "log out of all devices" (global sign-out), change password, forgot
  password by email.
- Every cookie-authenticated mutating route checks the `Origin` header matches
  the app and requires a JSON content type (CSRF defence in depth).

### Data (new migration; RLS on, no policies, server-only access, as today)

- `profiles(user_id pk -> auth.users on delete cascade, display_name, display_name_key unique, created_at)`.
  `display_name_key` is the lower-cased, trimmed name. Length 1-40 (builder may
  tighten the character set).
- `linked_wallets(wallet_address pk, user_id -> auth.users, linked_at)`.
  Primary key on the address enforces one account per wallet.
- `wallet_link_nonces(nonce pk, user_id, wallet_address, expires_at, used_at)`.
- `workout_sessions` gains an `account_id` column recording who submitted, for
  audit. Reps stay `unverified`.
- The old wallet-keyed `users` table stops being used. Drop it if nothing
  references it; only `app/api/users/route.ts` reads it today.

### Linking a wallet

1. Logged-in user connects a wallet in the browser (desktop).
2. Server issues a nonce bound to the account and wallet, valid 5 minutes.
3. The wallet signs a message (shared by client and server in one lib file)
   containing: app name, account ID, wallet address, nonce, expiry.
4. Server verifies the session, nonce (belongs to this account, unused,
   unexpired), and the ed25519 signature, then in one atomic step marks the
   nonce used and inserts the link. If the address is already linked to any
   account the answer is a plain conflict that doesn't say which.

### Unlinking

Requires a recent login (re-enter password) **and** a fresh signature from that
wallet over an unlink message. Blocked while the wallet has an unsettled
challenge membership, or a settled one with an unclaimed payout (checked
on-chain), so a user can't lose access to money they could still claim.

### API trust changes

- `POST /api/workout-sessions`: account session required. Accept only if the
  challenge/member accounts check out as today (membership, deadline, integer
  reps, idempotency key) **and** `memberAcc.owner` is one of the account's
  linked wallets. Insert as `unverified`.
- `POST /api/challenges/close`: account session plus creator-or-member check
  against linked wallets. Existing "settled and every member claimed" gate
  unchanged. Wallet signature removed.
- `GET /api/users?wallets=`: same response shape, now resolved through
  `linked_wallets` then `profiles` so `useDisplayNames` keeps working. Public;
  returns names only.
- `POST /api/users` and the wallet-signed display-name flow are replaced by a
  profile endpoint for the logged-in account.
- Unchanged: `/api/oracle/settle`, the program and all on-chain checks.

### Client behaviour

- "My challenges" and the scoreboard shortcut are built from the on-chain
  member accounts of **all** linked wallets, so a phone with no wallet still
  sees them.
- On desktop, the connected wallet must be one of the account's linked wallets;
  otherwise the app offers to link it. Actions that need a signature use the
  connected wallet.
- On the phone, signing actions show "needs your wallet" until project 2.
  The squat session no longer asks for a wallet signature, so the camera starts
  right after the permission prompt.

### Security checklist

Verified email; generic errors on login, sign-up and reset (no enumeration);
password length and breach-check as far as the Supabase plan allows; Supabase's
auth rate limits plus our own limit on the link-nonce and link endpoints
(mechanism is the builder's call); optional TOTP with a nudge after sign-up;
global sign-out; no email, token or password in logs or client-visible APIs;
service-role key server-only; CSRF origin check; links expire in 5 minutes and
are single-use.

## Left to the builder

File layout, migration filename and the exact on-chain query for "does this
wallet have an open membership"; the rate-limit mechanism; `proxy.ts` matcher;
screen design (follow the existing dark theme and Redaction headings); test
structure, using the existing node:test harness and Playwright smoke with mocks.

## What Stephen must do outside the code

- Supabase dashboard: require email confirmation, set the site URL and redirect
  allow-list (production plus Vercel previews), enable TOTP MFA.
- Choose and configure custom SMTP before real sign-ups.
- Run a real devnet check on a desktop and a phone once built.

## Verification plan

Unit tests for the link message, nonce single-use and expiry, unlink guard, the
workout and close routes (including a wallet that isn't linked, an account that
isn't a member, and a wrong-origin request), and name uniqueness. Playwright
smoke with mocked auth for login-gating, invite preview and the linked-wallet
list. Mocks don't establish real Supabase email delivery or real phone
behaviour; those need a manual check and will be reported as unverified until
then.
