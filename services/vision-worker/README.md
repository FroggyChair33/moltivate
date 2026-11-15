# Moltivate vision worker — experiment 0.3

An isolated **local-video CPU worker** for squats, push-ups, sit-ups and jumping
jacks. It counts candidate movement cycles and writes diagnostics. It does not
connect to the app, Chert, Supabase, wallets, an oracle or a payout service.

Read the repository's root `HANDOFF.md` first and then
[INTEGRATION_HANDOFF.md](INTEGRATION_HANDOFF.md). The app agent owns `apps/app/`,
its API and migrations. This worker owns only this folder and its scoped CI job.

## What changed from the Vultr v0.2 script

- Auto-select the usable left or right side using landmark visibility/presence.
  Keep that side locked while it remains usable. Tracking loss clears the
  unfinished cycle; after sustained loss the worker can acquire the other side.
  It must see a new neutral position before counting again. It never picks a
  side because it produces more reps.
- Use MediaPipe **estimated 3D world joint angles**, with image posture gates,
  instead of a fixed left-leg 2D angle. World-angle geometry tolerates camera
  yaw better, but inferred depth and occlusion can still be wrong.
- Add separate exercise rules, synchronized arms/legs for jacks, endpoint dwell,
  duration limits, initial partials and explicit tracking/geometry failures.
- Decode MP4/MOV with FFmpeg, including rotation metadata. Preserve proportions
  in a 640×640 frame sampled at 10 fps. Other accepted containers are MKV, WebM
  and AVI; actual codec support depends on the installed FFmpeg.
- Save `result.json`, per-frame `frames.csv`, and optionally `overlay.mp4` with
  joint nodes, skeleton, current state and rejection reason.

**This is not an “any camera angle” guarantee.** Use a stationary, level camera
with the whole body in frame and enough light. End-on floor views, hidden joints,
steep overhead views and camera movement may require a retry. Estimated 3D is
not measured depth. These rules are provisional; they do not assess safe form,
identify a person, prove liveness or independently establish exercise identity.

## Movement definitions

| CLI name | One full cycle | Useful starting view | Current scope |
| --- | --- | --- | --- |
| `squats` | Extended knees → bent knees → extended knees | Side or oblique; front view needs testing | Upright bodyweight squat |
| `pushups` | Arms extended → elbows bent → arms extended | Side or oblique with wrists and feet visible | Standard straight-leg floor push-up; knee push-ups not included |
| `situps` | Torso lowered → torso raised → torso lowered | Side or oblique, hips, knees and feet visible | Bent-knee floor sit-up; not a small crunch |
| `jumping_jacks` | Arms/feet closed → both arms overhead and feet apart → closed | Front or oblique with both sides visible | Coordinated open/close cycle; airborne phase is not verified |

Start in the first position for one second, complete controlled repetitions,
then finish there for one second. A recording beginning mid-repetition may
produce an `initial_partial` event rather than a full cycle. Fast movement that
does not dwell at endpoints can be missed at this experimental 10-fps setting.
Thresholds are in `motion_core.py`; changing them requires a rule-version bump
and new evaluation, not tuning solely to make a particular clip pass.

## Install on the existing Vultr VM

Run these in the **Ubuntu SSH terminal**, as `moltivate`. This uses a new
checkout and virtual environment, preserving `~/moltivate-vision` and its videos.
The branch is intentionally separate from the app agent's branch.

```bash
git clone --depth 1 --branch codex/vision-worker-v03 https://github.com/betrji/moltivate.git ~/moltivate-worker-v03
cd ~/moltivate-worker-v03/services/vision-worker
sudo apt-get update
sudo apt-get install -y python3-venv ffmpeg libgl1 libegl1 libgles2 libglib2.0-0
bash bootstrap.sh
source .venv/bin/activate
```

Target: Ubuntu 24.04, x86_64, Python 3.12, FFmpeg 6.1 or later. The Linux CLI uses
`fcntl` and POSIX signals; run it on Vultr, not directly in Windows PowerShell.
Use the exact dependency lock in a separate environment. MediaPipe **0.10.21**
is pinned because its CPU Tasks runtime completed the local inference smoke
test; 1.2.3 failed to initialize in the restricted test host. This does not
establish that 1.2.3 is broken on Vultr. The older v0.2 environment is untouched.
The official lite-model download is verified with a pinned SHA-256.

## Run your existing squat clip first

```bash
python moltivate_motion.py ~/moltivate-vision/videos/squats.mp4 \
  --exercise squats --output-dir results/squats-v03 --overlay
```

Use a **new output directory per run**; existing results are never overwritten.
Then test the new recording, for example:

```bash
python moltivate_motion.py ~/moltivate-vision/videos/squats2.mov \
  --exercise squats --output-dir results/squats2-v03 --overlay
```

For each new exercise, upload its recording into this worker's `videos/` folder
and use the matching selector:

```bash
python moltivate_motion.py videos/pushups.mov --exercise pushups --output-dir results/pushups-01 --overlay
python moltivate_motion.py videos/situps.mov --exercise situps --output-dir results/situps-01 --overlay
python moltivate_motion.py videos/jumping-jacks.mov --exercise jumping_jacks --output-dir results/jacks-01 --overlay
```

The filenames above are examples, not files supplied with the worker. The
default `--side auto` handles selection. `--side left` or `--side right` is only
for diagnostics of unilateral rules; jacks always require both sides.

To retrieve a skeleton video, open a **separate local Windows PowerShell**:

```powershell
scp -i "$env:USERPROFILE\.ssh\moltivate_vultr" moltivate@96.30.205.18:~/moltivate-worker-v03/services/vision-worker/results/squats-v03/overlay.mp4 "C:\Users\Public\Downloads\squats-v03-overlay.mp4"
```

Do not run that Windows command inside the Ubuntu SSH terminal. Review whether
the skeleton follows the intended body, and compare the event times to manually
counted repetitions. If a clip looks sideways, dark or washed out in the overlay,
fix capture/decode issues before adjusting movement thresholds.

## Output and retry behavior

`experimental_only` means enough frames passed the measurement gates; it never
means an accepted or verified workout. `needs_retry` is returned for fewer than
10 usable frames, under 75% usable coverage, or any detected multiple-person
frame. `complete_cycles` in either status are **observed candidate cycles only**.

Every result includes `payout_eligible: false`, `form_assessed: false`,
`identity_verified: false`, `liveness_verified: false` and
`exercise_identity_verified: false`. Never map these counts to an accepted
workout, challenge score or settlement. Partial cycles remain separate.

`rejected_frame_reasons` distinguishes no detected person, weak/conflicting
landmarks, cropped joints, unreliable world geometry, an unobservable torso,
and exercise posture gates. `tracking_interruptions` counts contiguous rejected
episodes, not frames. CSV rows include both sides' confidence and rejection
reason, the selected side, joint features and state. Visibility scores are
model outputs, not calibrated probabilities that a rep is correct.

## Resource and privacy bounds

Local files only; at most 100 MiB, 60 seconds and 4096 pixels per dimension.
The decoder is restricted to supported local containers and protocols. At most
600 samples are analyzed, with a 180-second process alarm. A file lock prevents
overlapping CLI jobs in the same checkout. Start with **one job at a time** on
the existing 2-vCPU/4-GB machine; benchmark before adding concurrency or a GPU.
FFmpeg uses two threads; CPU library thread settings are hints, not isolation.

There is no public HTTP listener. Before accepting untrusted uploads remotely,
add an authenticated adapter, isolated job supervisor with a hard timeout and
memory limit, bounded queue, server session binding, replay detection and
idempotent result handling. This CLI is not a hardened upload service.

Outputs are private (directory 0700, files 0600), silent videos contain no audio,
and source recordings are not modified. Media, model binaries, logs and outputs
are ignored by Git. No automated retention is implemented: delete recordings
and derived overlays/CSV after review according to the team's retention policy.
Do not put them on-chain or in a public PR.

## Checks and current evidence

```bash
python -m unittest discover -s tests -v
python -m py_compile motion_core.py moltivate_motion.py
bash -n bootstrap.sh
```

The suite covers synthetic 3D rotations and mirroring, exercise endpoints,
negative controls, side locking/reacquisition, tracking gaps, partials, duplicate
prevention, file limits, MOV decoding and rotation metadata. The rounded v0.2
angle trace from the original squat diagnostic still yields **3 complete +
1 initial partial** in the counter regression. That is not a replay of the
original video through the new model/rules.

The rule/geometry tests use synthetic landmarks. There is not yet a labeled
real-video evaluation across people, camera views and all four exercises.
Record several known-count clips plus standing, arm-only and incomplete-motion
controls. Compare the result, CSV and overlay before changing thresholds.
Neither the original nor newer user workout footage was available on the
implementation machine. Deployment and accuracy on the Vultr VM remain to test.

References: [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python),
[MediaPipe 0.10.21](https://pypi.org/project/mediapipe/0.10.21/),
[FFmpeg documentation](https://ffmpeg.org/ffmpeg.html).
