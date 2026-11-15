# Moltivate vision worker — experiment 0.3.2

An isolated **local-video CPU worker** for squats, push-ups, sit-ups and jumping
jacks. It counts candidate movement cycles and writes diagnostics. It does not
connect to the app, Chert, Supabase, wallets, an oracle or a payout service.

Read the repository's root `HANDOFF.md` first and then
[INTEGRATION_HANDOFF.md](INTEGRATION_HANDOFF.md). The app agent owns `apps/app/`,
its API and migrations. This worker owns only this folder and its scoped CI job.

## Flexible push-up counting (0.3.2)

The user selected a more forgiving return-to-top definition after reviewing
missed top positions in a second push-up recording. Push-ups now default to
`--pushup-profile flexible`; `strict` preserves the previous counting rule.
These are explicit counting policies, not automatic per-video calibration.

| Rule | Flexible (default) | Strict (previous behavior) |
| --- | --- | --- |
| Estimated elbow angle at top | At least 145 degrees | At least 155 degrees |
| Consecutive observed top span | At least 0.10 seconds | At least 0.15 seconds |
| Bottom elbow angle and hold | At most 100 degrees for 0.15 seconds | Same |
| Minimum cycle duration | 0.5 seconds | Same |
| Body/knee posture and confidence gates | Unchanged | Unchanged |

At 10 sampled fps, flexible still needs two consecutive top samples and three
bottom samples. A single top spike, shallow bend, static hold or initial partial
is not a full cycle. Tracking gaps still reset unfinished cycles; after a gap
the shorter top hold allows reacquisition from fresh observed frames. No missing
frames are interpolated, credited, or silently treated as valid.

```bash
git pull --ff-only
source .venv/bin/activate
python moltivate_motion.py videos/pushups2.mov --exercise pushups \
  --pushup-profile flexible --output-dir "results/pushups2-flexible-$(date +%Y%m%d-%H%M%S)" --overlay
```

Use `--pushup-profile strict` and a different output directory for a comparison.
The option is rejected for other exercises; squat calibration is unchanged.
The result records the chosen profile, thresholds and dwell times in `rules`.

Local replay of the user's saved **feature CSV**, using its existing confidence
and posture rejections, produced **5 candidate cycles** with flexible and **0**
with strict. Flexible completions were at 7.3, 8.9, 10.4, 11.9 and 13.4 seconds.
This replays stored measurements, not video/model inference; a VM rerun is still
needed. The user's trace and screenshots are not committed as test fixtures.
The 55-test suite passes, including synthetic profiles, partials, brief spikes,
shallow movements, tracking gaps and regressions for the other exercises.

Whole-clip coverage remains 118/181 (65.2%) on that replay, so **`needs_retry`
remains despite the five candidate cycles**. Setup/exit footage contributes to
this coverage result. Do not silently crop to the best-tracked portion or credit
these counts as verified results. Future app capture should start after its
preparation/framing step; any explicit analysis interval needs its own policy.
All form, identity, liveness, exercise-identity and payout flags remain false.

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

### If tracking works but no standing endpoint is recognized

The first real v0.3 run of the original squat clip tracked 112/112 frames, yet
reported zero cycles: estimated 3D knee angles peaked at 160.091°, barely above
the fixed 160° standing threshold. A single maximum cannot establish a held
neutral position. Version 0.3.1 reports `neutral_endpoint_not_observed` and
`needs_retry` in that situation instead of merely reporting tracking success.

Inspect the original overlay and identify **0.4–3 seconds visibly held fully
standing**. Use that interval explicitly for diagnostic calibration:

```bash
git pull --ff-only
python moltivate_motion.py ~/moltivate-vision/videos/squats.mp4 \
  --exercise squats --squat-standing-window 1.6 2.2 \
  --output-dir results/squats-v031 --overlay
```

The example interval comes from the earlier diagnostic trace for this particular
clip; confirm it in the overlay before using it. Other videos require their own
standing interval. Do not use a squat bottom or a partial standing position.
This operator label is not proof of standing and does not verify form.

Calibration requires at least five consecutive usable frames of the same side,
median angle ≥145° and spread ≤12°. It sets neutral to the reference's lower
decile minus a fixed 5° allowance, bounded to 140–175°. Bent remains 110°,
so at least a 30° separation is preserved. These bounds are experimental, not
medical limits. Invalid references fail explicitly without publishing a result.

The worker then replays cached poses with that reference side fixed and writes
matching counts, CSV and overlay. It runs inference once; an optional overlay
adds a second video decode without retaining pixels in memory. The chosen
reference and threshold are recorded in `calibration` and `rules`. It never
calibrates from the maximum angle, requested rep total, or number of detected
cycles. An initial partial remains separate, and tracking gaps still reset reps.
This is a diagnostic workflow, not a validated automatic camera calibration.

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
10 usable frames, under 75% usable coverage, any detected multiple-person
frame, or no held neutral endpoint despite at least 10 usable frames.
`complete_cycles` in either status are **observed candidate cycles only**.

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
python -m py_compile motion_core.py calibration.py moltivate_motion.py
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
User-reported Vultr runs of v0.3.1 on the second squat recording found four
candidate cycles matching the user's manual count, in 5.754 seconds without
overlay (15.798 seconds of footage). These were not independently replayed from
video here. Push-up feature replay and the newer v0.3.2 policy are described
above; real-video validation of sit-ups and jumping jacks remains pending.

References: [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python),
[MediaPipe 0.10.21](https://pypi.org/project/mediapipe/0.10.21/),
[FFmpeg documentation](https://ffmpeg.org/ffmpeg.html).
