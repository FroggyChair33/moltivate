# Mobile app design checkpoint

Updated 2026-11-15 on `codex/pwa-functional-flow`.

The Next.js app now carries the marketing site's cream paper, forest green,
copper accents, Fraunces headings, DM Sans interface text, and La Belle Aurore
handwritten notes. The Solana wallet control uses the marketing App Store
button's pale green glass treatment. Wallet-adapter owns connection behavior.

## Pages and assets

- Home introduces the club, coaching, commitments, invitations, and installation.
- `/coach` provides preparation guidance and links to the user's challenges.
  The in-browser camera is the only capture path. There is no fake call
  button, pretend video, streaming count, or fabricated conversation.
- `/club` collects challenge discovery, results links, invitations, and the
  existing display-name editor.
- Create, invite, leaderboard, browser workout, and results screens share the
  typography, panels, mobile navigation, and short original motivational notes.
- `apps/app/app/components/club-art.tsx` owns the polaroid placeholders and
  original SVG doodles. Future supplied photos should replace the interior of
  `Polaroid`, preserving the frame and caption and adding meaningful alt text.
  No user photographs are bundled or uploaded by this change.

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
