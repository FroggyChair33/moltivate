# PWA implementation checkpoint

November 15, 2026. Branch codex/pwa-functional-flow, built on Stephen's
7acf508 baseline.

## Implemented

- Challenge discovery combines creator accounts (Challenge.creator at byte 8)
  with TeamMember memberships (owner at byte 72), retaining Anchor's account
  discriminator filtering. Results are deduplicated by challenge address.
  Settled challenges and pending claims stay accessible. Existing dismissals
  are respected, with pending claims still shown.
- Home presents challenges, results, create, invite entry and iPhone installation
  instructions using the existing Fraunces/DM Sans fonts and paper/pine palette.
  Existing commitment slips, dark scoreboard, create/join and results are reused.
- Wallet changes remount wallet-specific challenge, join, results and display-name
  views. Discovery refreshes on navigation, focus and successful mutations.
  The scoreboard also refreshes every 30 seconds while visible and retains its
  last successful result on transient errors.
- Browser squat submissions retain their idempotency key on retry, report HTTP
  failures and refresh standings after saving. Camera-start failures stop tracks.
- Claim success refreshes results and discovery. The close button is creator-only
  and remains gated on all claims. Existing server close authentication still
  accepts a supplied wallet address and should be coordinated with the backend
  owner before production use.
- Safe-area spacing, visible keyboard focus, reduced motion, input sizing and
  wrapping support small screens. Manifest colors match the app. Injected Phantom
  can reach the connect control on mobile; other mobile browsers receive recovery
  guidance. Route errors have retry/home recovery.

## Verification performed

Using the existing audited Node 24.22.1 Windows toolchain:

```text
npm ci --ignore-scripts
npm run lint
node --test tests/challenge-discovery.test.mjs
npm run build
```

All completed successfully. The two discovery regression tests use mocked Anchor
accounts, including creator-only, member-only, creator/member deduplication,
pending and completed claims, and RPC rejection. The lockfile was preserved.
The initial install under the system Node 22 failed lockfile validation;
using the required Node 24 succeeded.

Browser inspection covered the public marketing reference at desktop and phone
widths, local home at desktop and 320 px, results recovery at 430 px, invalid
invite validation, create-wallet prompt, wallet modal opening and Escape
dismissal, and disconnected scoreboard/results recovery. No horizontal overflow
was found in the inspected 430 px results DOM.

These checks did not execute actual wallet transactions or capture a workout.
Connected scoreboard/results, camera denial, long real team names, cancelled
wallet signing, settled claims/close on devnet, and physical iPhone Safari,
installed mode and Phantom remain device/integration validation work.
The original Phantom blank-screen cause is not established. Reduced-motion
behavior is implemented in CSS but was not tested with an OS preference change.

## Integration boundary

The current app endpoint POST /api/workout-sessions is a completed-workout
submission from the in-browser counter, the only capture path. Every
submission is stored as unverified.

The current backend's treatment of unverified workout rows at settlement is
existing demo behavior. This UI increment does not establish payout verification.
Service-worker offline transactions and native Expo work are outside this brief.
