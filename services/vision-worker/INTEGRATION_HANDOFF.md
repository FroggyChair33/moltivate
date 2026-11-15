# Vision worker handoff

## Latest: flexible push-up policy, 0.3.2

The user reviewed two missed push-up top positions and explicitly requested
that they count without requiring full elbow lockout. `flexible` is now the
default push-up profile: top >=145 degrees held for >=0.10 seconds. The `strict`
profile retains >=155 degrees for >=0.15 seconds. Bottom <=100 degrees for
>=0.15 seconds, cycle duration >=0.5 seconds, side locking, confidence, posture,
coverage and trust flags are unchanged. This is a versioned product-policy
change, not automatic calibration to a requested repetition count.

Use `--pushup-profile flexible` or `--pushup-profile strict` only with pushups.
The output's `rules` records the profile and dwell times. Missing frames still
reset an unfinished cycle. The shorter top hold reacquires readiness from
fresh frames after a brief glitch; it does not bridge an unobserved movement.

The uploaded pushups2 feature CSV was replayed locally through the updated
session/counter using stored per-side confidence and rejection reasons: strict
0, flexible 5 candidate cycles (ends 7.3, 8.9, 10.4, 11.9, 13.4 seconds).
No fresh model inference was performed on that video here. Whole-clip coverage
stays 118/181 and status stays `needs_retry`; do not claim accepted workouts.
Do not commit the private CSV or screenshots. 55 automated tests passed locally;
the new profile still needs a video rerun on Vultr and broader labeled footage.

Current root documentation is in PR #19 on `codex/workout-prep-countdown`.
Read that handoff as well: the intended mobile target is Expo, the preparation
countdown runs on the phone, and app/backend work stays with the app agent.
Existing Next.js work must be preserved during the native transition.

## Scope and ownership

This increment adds the isolated Python worker under `services/vision-worker/`
and `.github/workflows/vision-worker.yml`. It is developed on
`codex/vision-worker-v03` for a later reviewed merge. It does not change
`apps/app/`, `apps/web/`, contracts, migrations, dependencies outside this worker,
or the root `HANDOFF.md`.

The root handoff was read at main commit
`23ed950de04596337331608beb2f6af8732907ea`. Its newest section points at app PR
#16 (`78cf4f0a46b416a2b2c9ce65614935b2ffcd81fe`), explains the unavailable old
oracle stash, and includes local app/database patches to carry forward.
Re-read the current root handoff before integrating; the app agent may have
advanced since then. Do not restore the historical stash instructions or infer
that Supabase/oracle credentials are available.

## Implemented

Version 0.3.1 addresses the first user-reported v0.3 result: 112/112 usable
squat frames but zero counts, with the 3D knee maximum at 160.091°. Neutral
endpoint acquisition now has its own diagnostic and can cause `needs_retry`
despite good landmark coverage. Explicit `--squat-standing-window START END`
calibration uses an operator-labeled held standing interval, freezes its side
and threshold, then replays cached poses; it does not select thresholds to
produce a desired rep total. Output records the reference and does not verify
that the operator's label is correct. For a future live flow, collect an
explicit standing reference before exercise and validate it; that live flow is
not implemented here.

- CLI processing of local footage on CPU; MediaPipe Tasks + FFmpeg.
- Experimental squat, push-up, sit-up and jumping-jack motion rules.
- Automatic visible-side selection, 3D joint angles, conservative posture gates,
  full/partial cycles, interruption resets and coverage diagnostics.
- Private JSON/CSV and optional skeleton MP4; one CLI job per checkout;
  input/time bounds; pinned dependencies/model checksum; scoped tests and CI.

No Chert caller-video connection, LiveKit subscriber, live coach, authenticated
worker API, database write, oracle signature or settlement is implemented here.
Vultr is the user's chosen host, superseding the older Railway/Render proposal
for this worker. CPU capacity for simultaneous live sessions is unmeasured.

## Result contract boundary

`moltivate_motion.py` prints one JSON object on stdout on a completed job and
saves the same object as `result.json`. Native warnings and fatal errors use
stderr. Exit 0 means the analysis finished, including `needs_retry`; nonzero
means processing failed and no result may be consumed. A partially written
artifact directory is not a successful job.

Core fields: `verifier_version`, `exercise`, `status`, `complete_cycles`,
`initial_partial_cycles`, `events`, `frames_analyzed`, `usable_joint_frames`,
`usable_fraction`, `retry_reasons`, `rejected_frame_reasons`,
`side_acquisitions`, `feature_ranges`, `neutral_holds_observed`, `calibration`,
`model_sha256` and `mediapipe_version`.
Events contain a type, start time and end time relative to the decoded clip.
They are not server-issued workout/session identities or trusted timestamps.

All five trust flags are false: payout, form, identity, liveness and exercise
identity. `status: experimental_only` is diagnostic success, not an accepted
workout. `needs_retry` can still contain candidate counts from visible portions;
the app must not count those as accepted exercise. Initial partials are never
folded into complete cycles.

## Later integration owned jointly with the app agent

1. Keep the Next.js API as the app backend. Add only a narrow worker adapter;
   do not recreate accounts, challenges or settlement in Python.
2. Authenticate and bind capture to a server-issued workout session and verified
   membership. The API supplies the authorized exercise and deadline. A CLI
   label, uploaded video and returned JSON do not establish trust on their own.
3. Verify actual Chert caller-frame availability before building a LiveKit
   adapter. Keep uploaded-clip testing separate from the intended live path.
4. Evaluate all exercises against labeled real recordings from several people,
   including front/side/oblique and failure views. Set rule versions and
   acceptance criteria with observed errors, not just synthetic tests.
5. Add authenticated transport, scoped media access, retention, replay/liveness
   defenses, job deduplication, bounded queue/supervisor and durable result
   reconciliation. Keep trusted and fallback capture paths distinguishable.
6. Only a separately implemented, tested and authorized acceptance path may
   update accepted workout totals. The current worker must remain unverified
   under the database acceptance constraint described in the root handoff.

The user has run v0.3.1 in the separate
`~/moltivate-worker-v03/services/vision-worker` checkout on Vultr; preserve the
earlier `~/moltivate-vision` directory and its media. Pull this branch in the
worker checkout, rerun `videos/pushups2.mov` with the flexible profile, and
compare events and the overlay. Four squats on the second squat clip were
previously reported matching the manual count. Other exercise video accuracy
and the 0.3.2 VM rerun remain to verify.
