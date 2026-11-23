# apps/app

The Moltivate Next.js app: pages, components, and the API routes that are the whole backend.

See the [project readme](../../readme.md) for what it does and how to run it, and [DEPLOYMENT.md](DEPLOYMENT.md) for Vercel setup and environment variables.

## Accounts

Users sign up with an email and password (Supabase Auth; sessions are cookies handled with `@supabase/ssr`). `proxy.ts` redirects signed-out visitors to `/login` (invite pages under `/join/` stay public as a preview), and every API route re-verifies with `requireAccount`. Display names are unique, case-insensitively. A wallet is linked to an account by signing a message through `/api/wallet-links`; workouts and closing a challenge are authorized by the account's linked wallets. On a phone you can log in and record workouts; deposits, creating a challenge and claims need desktop Phantom until phone signing is built.

Status: implemented and covered by unit tests and the mocked UI smoke test. Not yet run against a real Supabase project, real Phantom or a real phone. The migration `supabase/migrations/20261123010000_accounts.sql` must be applied, and the Supabase dashboard configured, before this version works; see [DEPLOYMENT.md](DEPLOYMENT.md#accounts-setup-required-before-this-version-works).
