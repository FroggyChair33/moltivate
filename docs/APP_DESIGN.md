# Mobile app design checkpoint

Updated 2026-11-20 on `experimental`.

The palette is centered on brand blue `#0496ff`: a cool off-white page,
white panels, deep navy (`#0a2540`) text and dark cards, and blue for every
primary action, focus ring and progress bar. Tokens live in `:root` in
`app/globals.css`. Fraunces is the heading serif and DM Sans the interface
text. Controls are flat: no paper texture, glossy wallet badge, rotated
avatars or mascot.

## Pages and assets

- **Navigation has two items:** Challenges (`/`) and New challenge
  (`/challenges/new`). Creating a challenge has no other entry point.
- **Home (`/`) is the dashboard:** your display name, your challenges, and
  joining by invite. `/club` and `/coach` redirect here; they were merged
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

## Verification

Use Node 24 and the existing lockfiles. From the repository root:

```powershell
npm.cmd --prefix apps/app run lint
npm.cmd --prefix apps/app run build
npm.cmd --prefix apps/app run start -- --hostname 127.0.0.1 --port 13000
# In another terminal (needs `npx playwright install chromium` once):
node apps/app/tests/ui-smoke.mjs
```

The browser script uses a simulated Phantom wallet, synthetic Anchor account
data, and intercepted totals responses. It never signs a transaction. It covers
mobile widths, navigation, invite validation, count and rank updates, outage
retention/recovery, camera denial, and reduced motion. Screenshots are written
under ignored `test-results/app-design/`.

These checks do not establish real iPhone camera/wallet behavior, deployment,
or a completed end-to-end devnet workout.
