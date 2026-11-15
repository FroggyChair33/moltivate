# Deploying apps/app to Vercel (Hobby tier)

This covers only the Next.js app in this directory. The Chert/MediaPipe video
pipeline is a separate service a teammate runs on its own VM (see root
`AGENTS.md` "Technical direction") and is out of scope here.

## Monorepo: set Root Directory

This repo is a monorepo (`apps/app/`, `apps/web/`, `programs/commitment-stakes/`
all live at the repo root). Vercel's project needs to be told the Next.js app
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
- `apps/app/package.json` did **not** have an `engines` field (this repo's
  root `engines` field is irrelevant to Vercel once Root Directory is
  `apps/app` -- Vercel reads `engines.node` from the `package.json` inside
  the configured root directory). Vercel's current default Node.js version
  for new projects is **26.x** (22.x, 24.x and 26.x are the available major
  versions as of this writing), which would silently build this app on a
  newer Node than it's developed/tested against.
- Fixed by adding the same `"engines": { "node": ">=24 <25" }` to
  `apps/app/package.json`. Per Vercel's docs, a semver range in `engines.node`
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

| Variable | Scope | In `.env.example`? | Status in this repo | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SOLANA_NETWORK` | Public (client+server) | Yes | Used (`devnet` default) | Keep `devnet` per root `AGENTS.md` "Financial correctness" -- mainnet needs a separate reviewed release. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Public (client+server) | Yes | Used (`app/providers.tsx`) | Devnet RPC endpoint, e.g. `https://api.devnet.solana.com`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public (client+server) | Yes | In `.env.example`, not yet read by any code on `main` | Supabase project REST URL. Safe to expose (anon key is what gates access). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (client+server) | Yes | Same as above | Supabase anon/public API key -- safe to expose by design, RLS enforces access. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only secret** | Yes (empty) | Same as above | Bypasses RLS. Never expose to the client, never commit a real value. |
| `NEXT_PUBLIC_ORACLE_PUBKEY` | Public (client+server) | **No** | Not yet in `.env.example`; not wired into `main` (lives on the unmerged `stephen/wire-frontend-to-anchor-program` branch / PR #16) | The oracle keypair's public half. Safe to expose -- it's what challenges set as their on-chain `oracle` field. Add to `.env.example` when that branch merges. |
| `ORACLE_SECRET_KEY` | **Server-only secret** | **No** | Same as above | The oracle keypair's secret (64-byte JSON array from `Keypair.generate()`), used server-side to sign `settle()`. Never expose, never commit. |
| `WORKOUT_INGEST_SECRET` | **Server-only secret** | **No** | Not referenced anywhere in this repo yet (planned, not implemented) | Planned bearer token for the Chert/MediaPipe VM to authenticate its POSTs to `/api/workout-sessions`. See "Chert/MediaPipe VM integration" below -- the current stub route does not check any `Authorization` header, so there is nothing to configure yet beyond reserving the name. |

**Important caveat for whoever deploys this**: as of the commit this doc was
written against, `apps/app/app/api/oracle/settle/route.ts` does not exist on
`main` -- it exists only on the open, unmerged `stephen/wire-frontend-to-anchor-program`
branch (PR #16). `apps/app/package.json` on `main` also has no
`@coral-xyz/anchor` dependency yet. The `NEXT_PUBLIC_ORACLE_PUBKEY`,
`ORACLE_SECRET_KEY`, and `WORKOUT_INGEST_SECRET` variables above are
documented here because the real app needs them once that work merges, not
because `main` reads them today. Re-check this table (and the "Runtime"
section below) after that branch lands.

## Runtime: Node.js, not Edge (and don't force it either way)

- Grepped the whole `apps/app/app` tree for `export const runtime`: no route
  opts into the Edge runtime. Next.js API routes default to Node.js, which is
  what both `/api/workout-sessions` and (once merged) `/api/oracle/settle`
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
  legacy). Apply this same "don't add it" rule to `/api/oracle/settle` once
  that route merges.

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

**Risk assessment for `/api/oracle/settle`** (read from the unmerged
`stephen/wire-frontend-to-anchor-program` branch's version of this file,
since it doesn't exist on `main` yet -- this is forward-looking risk
analysis, not a change made to that route): it fetches on-chain challenge
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

## Chert/MediaPipe VM integration point

Once the teammate's Chert/MediaPipe VM is ready, it is expected to reach this
app over the public internet by POSTing to:

```
https://<vercel-deployment-url>/api/workout-sessions
Authorization: Bearer <WORKOUT_INGEST_SECRET>
Content-Type: application/json
```

**Current reality, not the planned end state**: the body shape the *existing
stub* route (`apps/app/app/api/workout-sessions/route.ts` on `main`) validates
today is:

```json
{
  "teamMemberId": "string",
  "idempotencyKey": "string",
  "source": "chert_facetime" | "browser_mediapipe",
  "reps": 10
}
```

It currently has no `Authorization` header check at all, and responds `501`
("No verifier or database is wired up yet. This session was not recorded.")
to any structurally valid payload -- see the route's own header comment.
There is nothing for the Chert VM to integrate against yet; `WORKOUT_INGEST_SECRET`
above is reserved for when that bearer-token check is added alongside the
real handler. Don't point the VM at this endpoint until that lands and this
doc is updated to match the real contract (including whatever on-chain
`challengePubkey`/`teamMemberPubkey` fields the merged `wire-frontend-to-anchor-program`
work ends up using instead of the mocked `teamMemberId`).

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

- `npm ci --ignore-scripts && npm run build && npm run lint` in `apps/app/`
  -- both clean (build succeeds, Turbopack production build, no lint errors).
- Confirmed via a real build attempt (not assumption) that adding
  `export const runtime = "nodejs"` breaks the build under Cache Components,
  per the "Runtime" section above.
- Did not deploy to Vercel, run `vercel link`, or run `vercel deploy` --
  out of scope for this change; a human should do that with a real Vercel
  account.
