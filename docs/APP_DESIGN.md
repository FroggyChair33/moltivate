# Mobile app design checkpoint

Updated 2026-11-20 on `experimental`.

The app uses one fixed dark theme centered on brand blue `#0496ff`: a
navy-black page (`#07121f`), slightly lighter panels, light text, and blue
for every primary action, focus ring and progress bar. Tokens live in
`:root` in `app/globals.css`. Redaction 35 (OFL) sets headings and the
wordmark; DM Sans sets everything else.
Controls are flat: no paper texture, glossy wallet badge, rotated avatars or
mascot.

## Pages and assets

- **Navigation has two items:** Challenges (`/`) and New challenge
  (`/challenges/new`). Creating a challenge has no other entry point.
- **Home (`/`) is the dashboard:** your challenges and joining by invite
  (the display name is set at sign-up and changed on the Account page). `/club` and `/coach` redirect here; they were merged
  into it (2026-11-20 UI simplification).
- Create, join, leaderboard, browser workout, and results pages share the
  typography, panels and buttons. Headings say what the page does;
  decorative quotes, photos and ribbons were removed.
- Camera setup guidance lives inside the workout session itself. The
  in-browser camera is the only capture path.
- `apps/app/app/components/club-art.tsx` holds the two nav icons.
- The leaderboard is a plain ranked list: rank number, team name, reps and
  a blue progress bar, with members listed by name and count.

Visual references were [Folk](https://www.folk.com/) for friendly coaching,
[HeyClicky](https://www.heyclicky.com/) for playful physical details, and
[pump.fun](https://pump.fun/) for dense updating leaderboard information.
The existing Moltivate marketing design remains the primary brand reference.
No assets or branded characters were copied from those references.

## Data behavior and integration boundary

The leaderboard polls the existing `/api/workout-sessions/totals` route and
existing devnet account reads every five seconds while the page is visible.
It refreshes on return to the page or a saved workout, avoids overlapping polls,
and retains the previous standings with an error state if a refresh fails.
Rolling digits animate actual fetched values and respect reduced motion.
On-chain half-rep units are converted to reps for presentation only.

These are saved workout totals, not a per-frame rep stream. Whether a
workout appears still depends on the existing backend's storage and status rules.
Counts remain experimental and do not establish payout eligibility.

No API routes, worker code, Anchor contracts, financial rules, signing, deposit,
settlement, or claim handlers were changed for this design increment. The browser
camera uses the existing local counter, which is the only capture path.

## Accounts

The app sits behind a login (`proxy.ts`); the invite pages under `/join/` show a
preview while signed out. An account is an email and password with a unique
display name; wallets are linked to it by signing a message, and the account page
manages linked wallets, password and optional 2FA. Challenges and actions follow
the account's linked wallets. A phone is designed to log in, view challenges
and record workouts (the camera and layout have not been checked on a real
device); deposits, creating a challenge and claims need desktop Phantom
until phone signing is built (planned, not started). This is implemented and
covered by unit tests and the mocked smoke test, not yet run against a real
Supabase project, Phantom or phone.

## Verification

Use Node 24 and the existing lockfiles. From the repository root:

```powershell
npm.cmd --prefix apps/app run lint
npm.cmd --prefix apps/app run build
```

The UI smoke test (`apps/app/tests/ui-smoke.mjs`) needs Chromium
(`npx playwright install chromium` once) and talks to a fake Supabase that the
script starts on port 13001 (`tests/fake-supabase.mjs`). The app must be built
and started against it with obviously fake keys, because `NEXT_PUBLIC_*` values
are inlined at build time. These are labelled test values, not real keys. From
`apps/app`, in PowerShell:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:13001"
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_smoke_test"
$env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_smoke_test"
npm.cmd run build; if ($LASTEXITCODE -eq 0) { npx.cmd next start -p 13000 }
# in another shell, from apps/app
node tests/ui-smoke.mjs
# afterwards, in the first shell: clear the test variables before a normal rebuild
Remove-Item Env:NEXT_PUBLIC_SUPABASE_URL, Env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Env:SUPABASE_SERVICE_ROLE_KEY
npm.cmd run build
```

or in bash:

```bash
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:13001 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_smoke_test SUPABASE_SERVICE_ROLE_KEY=sb_secret_smoke_test
npm run build && npx next start -p 13000
# in another shell, from apps/app
node tests/ui-smoke.mjs
# afterwards, in the first shell
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY
npm run build
```

In both forms the server starts only if the build succeeded. Always clear the
variables and rebuild afterwards (the last two lines) before using the app
against a real Supabase project, or the fake URL and key stay baked into
`.next`.

The browser script uses a simulated Phantom wallet, synthetic Anchor account
data, and intercepted totals responses. It never signs a transaction. It covers
the login gate, the signed-out invite preview, linked wallets on the Account
page, mobile widths, navigation, invite validation, count and rank updates,
outage retention/recovery, camera denial, and reduced motion. Screenshots are written
under ignored `test-results/app-design/`.

These checks do not establish real iPhone camera/wallet behavior, deployment,
or a completed end-to-end devnet workout.
