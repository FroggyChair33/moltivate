# Vision worker handoff

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
`side_acquisitions`, `feature_ranges`, `model_sha256` and `mediapipe_version`.
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

The user currently runs v0.2 in `~/moltivate-vision` on the Vultr VM. Install
v0.3 alongside it using this folder's README. Re-run `squats.mp4` and inspect
the overlay, then `squats2.mov` and the standing negative control. Do not claim
the VM was upgraded until those commands have actually run there.
