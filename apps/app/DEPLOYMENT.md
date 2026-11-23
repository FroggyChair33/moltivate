# Deploying apps/app to Vercel (Hobby tier)

This covers the Next.js app in this directory, which is the whole product:
pages, API routes and the settlement oracle.

**Never link or deploy this fork to the original project's `moltivate` Vercel
project.** Before `vercel --prod`, check that `apps/app/.vercel/project.json`
names this fork's own project.

## Monorepo: set Root Directory

This repo is a monorepo (`apps/app/`, `programs/commitment-stakes/` and
`supabase/` all live at the repo root). Vercel's project needs to be told the Next.js app
isn't at the repo root:

- Vercel dashboard -> Project -> Settings -> Build and Deployment -> **Root
  Directory** -> set to `apps/app`.
- No `vercel.json` is needed for this. Per Vercel's docs, Root Directory is a
  dashboard-only project setting; Next.js is auto-detected and builds
  zero-config once the root directory is correct. There is currently no
  `vercel.json` in this repo and nothing below requires adding one (see
  "Why no vercel.json" at the bottom).

## Node.js version

- Root `.node-version` pins `24.22.1`; root `package.json` has
  `"engines": { "node": ">=24 <25" }`.
- `apps/app/package.json` needs its own `engines` field (this repo's
  root `engines` field is irrelevant to Vercel once Root Directory is
  `apps/app` -- Vercel reads `engines.node` from the `package.json` inside
  the configured root directory). Vercel's current default Node.js version
  for new projects is **26.x** (22.x, 24.x and 26.x are the available major
  versions as of this writing), which would silently build this app on a
  newer Node than it's developed/tested against.
- So `apps/app/package.json` carries the same
  `"engines": { "node": ">=24 <25" }`. Per Vercel's docs, a semver range in `engines.node`
  resolves to the highest available major version satisfying it -- `>=24 <25`
  resolves to the latest 24.x build/function runtime, matching
  `.node-version`. Confirmed this doesn't break `npm ci`/build locally (no
  `.npmrc` with `engine-strict` in this repo).
- No Vercel-specific config file is needed for this; the Project Settings
  "Node.js Version" dropdown would otherwise need to be set to 24.x by hand
  on every new project creation, which the `engines` field makes unnecessary
  and keeps in version control.

## Environment variables

Set these in Vercel dashboard -> Project -> Settings -> Environment
Variables (not in `vercel.json`, and never committed). `NEXT_PUBLIC_*`
variables are embedded into the client bundle at build time and are visible
to anyone in the browser -- only put values there that are safe to expose.
Everything else is server-only and must never be marked public.

| Variable | Scope | Used by | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SOLANA_NETWORK` | Public | Not read by code | The network is hard-coded to devnet in `app/providers.tsx`; this variable is kept as documentation. Mainnet needs a separate reviewed release (root `AGENTS.md` "Financial correctness"). |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Public | `app/providers.tsx`, `lib/oracle.ts`, `lib/server-program.ts` | A **devnet-only** RPC URL (e.g. Helius `devnet.helius-rpc.com`). It ships in the browser bundle, so never use a key that also works on mainnet. Falls back to the public devnet endpoint if unset. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | `lib/supabase-server.ts` | The fork's own Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only secret** | `lib/supabase-server.ts` | Bypasses RLS. Never expose to the client, never commit. The server refuses an anon/publishable key here (`lib/supabase-key.ts`), since that would fail only on RLS-protected tables. |
| `NEXT_PUBLIC_ORACLE_PUBKEY` | Public | create form | The oracle keypair's public half; new challenges set it as their on-chain `oracle`. |
| `ORACLE_SECRET_KEY` | **Server-only secret** | `lib/oracle.ts` | 64-byte JSON array; signs `settle()` in `/api/oracle/settle`. Never expose, never commit. |

`next build` succeeds with none of these set (CI relies on this). But
`NEXT_PUBLIC_*` values are inlined into the bundle at build time, so set them
in Vercel before the production build, and redeploy after changing one. The
two secrets are read only at request time.

## Runtime: Node.js, not Edge (and don't force it either way)

- Grepped the whole `apps/app/app` tree for `export const runtime`: no route
  opts into the Edge runtime. Next.js API routes default to Node.js, which is
  what both `/api/workout-sessions` and `/api/oracle/settle`
  need, since `@solana/web3.js` and `@coral-xyz/anchor` require Node APIs and
  do not run on Edge.
- **Do not add `export const runtime = "nodejs"` to these routes.** This repo
  has Next.js 16 Cache Components enabled (`cacheComponents: true` in
  `next.config.ts`), and that feature is incompatible with the `runtime`
  route segment config. Tested this directly: adding the export to
  `app/api/workout-sessions/route.ts` and running `npm run build` fails with
  `Error: Route segment config "runtime" is not compatible with
  nextConfig.cacheComponents. Please remove it.` The Node.js default already
  applies with no `runtime` export needed, so the fix is to leave it out --
  which also matches Vercel's own current guidance (omit `runtime` entirely
  rather than writing `nodejs`, since Node.js is the default and Edge is
  legacy). The same "don't add it" rule applies to `/api/oracle/settle`.

## Hobby plan serverless function duration limits

Current (checked against Vercel's docs, not memory -- older "10s
default/60s max" numbers are stale):

| Plan | Default | Maximum |
|---|---|---|
| Hobby | 300s (5 min) | 300s (5 min) -- same as default, no extension available |
| Pro/Enterprise | 300s | 800s (1800s in beta, per-function only) |

Hobby's default and max are the same 300 seconds with Fluid Compute (the
current default execution model) -- there's no `maxDuration` headroom to
configure on Hobby, and setting one above 300s there has no effect.

**Risk assessment for `/api/oracle/settle`**: it fetches on-chain challenge
accounts, then for each target challenge, sequentially queries Supabase once
per team member (summing `workout_sessions.reps`), then submits one
`settle()` transaction per challenge. For the hackathon's realistic demo
scale (a handful of challenges, a handful of members each), this comfortably
finishes in well under 300s -- a handful of Supabase queries (~100-300ms
each) plus a handful of devnet transaction confirmations (~1-2s each) is low
single-digit seconds total.

It is **not** risk-free at larger scale: both the Supabase queries and the
`settle()` calls run in a sequential loop (no `Promise.all`/batching), and
devnet RPC latency is occasionally much slower than 1-2s. Dozens of
challenges with multi-member rosters could plausibly approach the 300s
ceiling, especially if this is ever wired to a cron trigger scanning *every*
eligible challenge in one invocation rather than one challenge per call. Not
adding `maxDuration` speculatively here -- Hobby's ceiling is already fixed
at 300s regardless (raising it requires Pro), and for this project's actual
demo scale there's no indication the current sequential approach is a
problem. If challenge/member counts grow materially, the fix is parallelizing
the per-member Supabase reads (not a duration-limit workaround, a real
scaling fix) or upgrading to Pro for 800s, not a Hobby-only config tweak.

## Why no `vercel.json`

Checked: there is no `vercel.json` in this repo. Per Vercel's docs, a
standard Next.js app with the Root Directory set correctly builds
zero-config -- Framework Preset, build/install/output commands are
auto-detected. None of this project's other needs (duration overrides,
crons, custom headers/redirects, multiple regions) apply, so no
`vercel.json` was added. Add one only if a concrete future need arises
(e.g. a cron-triggered `/api/oracle/settle` sweep, which would need a
`crons` entry) -- don't add it speculatively.

## Verification done for this doc

- 2026-11-18 (solo-fork cleanup): `npm ci`, `npm run lint`, `npm test` and
  `npm run build` in `apps/app/`, all clean. Not deployed.

Earlier, when this doc was first written:

- `npm ci --ignore-scripts && npm run build && npm run lint` in `apps/app/`
  -- both clean (build succeeds, Turbopack production build, no lint errors).
- Confirmed via a real build attempt (not assumption) that adding
  `export const runtime = "nodejs"` breaks the build under Cache Components,
  per the "Runtime" section above.
- Did not deploy to Vercel, run `vercel link`, or run `vercel deploy` --
  out of scope for this change; a human should do that with a real Vercel
  account.
