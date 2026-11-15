# Live coaching: start here

Updated 2026-11-15. This is the current handoff, superseding older hosting and native-app assumptions. Read root `HANDOFF.md`, then this file. Historical patches in that handoff are not instructions to reapply them.

## Current checkpoint

- Branch head was verified at `22acb38` in draft PR #21 before work. The
  Windows worktree is `live-coach-transport`. Vultr SSH succeeded and the
  isolated `~/moltivate-live` clone passed `bash ops/vultr/preflight.sh`
  on Ubuntu 24.04.5 and Python 3.12.3.
- The one-room transport probe is in `services/vision-worker/transport_probe.py`.
  Node 24.22.1 and Chert CLI 0.1.0-beta.19 are installed under
  `~/.config/moltivate-live`. Transport dependencies are frozen separately
  from the MediaPipe worker in `transport.requirements.lock.txt`.
- An isolated synthetic LiveKit test on Vultr passed dispatch, receipt of
  64×96 changing video and 48-kHz mono audio, reception of a non-silent agent
  cue by the synthetic peer, and agent departure after peer disconnect.
  The test server was stopped. LiveKit emitted FFI handle warnings during
  teardown. The room had no remaining participants and was deleted.
- **Real-phone transport passed on 2026-11-15.** Vultr ran commit `6fdbb57`
  and Chert CLI `0.1.0-beta.21` on the existing line. One inbound FaceTime
  Video call delivered changing 1280×720 frames and 48 kHz mono caller audio.
  The caller heard the generated tone. The bridge disconnected and the
  probe logged cleanup after hangup.
- **Live adapter is ready for manual phone validation.** The Python worker
  reuses the existing MediaPipe model and `MotionSession` for squats and
  flexible pushups. It receives the latest frame, resets unfinished motion
  on a tracking gap or track change, and counts during the timed active set.
  Offline speech gives framing, countdown and count cues. The 58-test suite
  and both loopback RTC smoke tests passed on Vultr. The synthetic RTC tests
  carried no actual reps.
- The first real squat call reached the countdown, which repeatedly reset
  and never started the active set. Preparation now tolerates brief tracking
  loss and checks the starting position again before “Go”. During a set,
  the existing 350 ms continuity limit still applies. The next phone test
  also uses Flite's female `slt` voice and updated coaching prompts.
- The retry reached the active set and counted one squat. The user reported
  that only one rep registered. The new live squat path ports the 2D left-knee
  rule from Claude co-authored commit `cc16424` on Stephen's branch. It keeps
  the original below-110° / above-160° transitions and resets on lost tracking.
  Pushups still use the flexible 3D tracker.
- The subsequent FaceTime squat call at `827ad0f` matched the user's manual
  count of seven. Its result was still `needs_retry` because nine frames
  contained multiple detected poses. The call also exposed a swapped
  argument order in LiveKit's mute callback, corrected in the next revision.
- **Next action:** validate flexible pushups on a physical phone. Repeat a
  squat call with the camera framed to isolate one person. Compare spoken
  counts with the manual count and check the evidence flags. Follow the
  [manual live rep test](VULTR_DEPLOYMENT.md#manual-live-rep-test).


## Checkout and model

Use branch `codex/live-coaching-handoff` in a separate checkout/worktree. It combines current main, worker source from PR #18, and countdown source from PR #19. Preserve the teammate's app work. Do not reset their working directory or merge into main automatically.

Choose **GPT-6.1 Sol / Medium** if available in local Codex. It fits this integration better than spending the remaining 18% on repeated broad architecture passes. Use Luna for narrowly specified documentation or mechanical edits if available. Availability and quota accounting vary; 18% does not guarantee a fixed number of tasks. Coding quota, runtime voice/API bills, Chert/LiveKit charges, and Vultr credits are separate.

Work one milestone at a time, keeping a short checkpoint in this file. No parallel agents unless requested. Reuse the existing counter; do not rewrite the financial backend. [Official model guidance](https://developers.openai.com/api/docs/guides/model-selection).

## Paste this into local Codex

> Continue Moltivate from docs/live/CODEX_START.md on codex/live-coaching-handoff. Read HANDOFF.md and AGENTS.md. Keep the main app team's files intact. Implement a LiveKit RTC frame adapter around services/vision-worker, with Chert managed FaceTime BYOR, live experimental rep counting, spoken coaching cues and an agent video skeleton overlay. The general backend stays on Vercel; the long-lived coach/MediaPipe process runs on our existing Vultr CPU VM. Follow ARCHITECTURE.md, ENDPOINT_CONTRACT.md and VULTR_DEPLOYMENT.md in docs/live. Start with one call and one participant; prove actual incoming caller frames before building the full UI. Use local SSH key access without printing keys or secrets. Implement, test and commit each milestone. Report blockers honestly; don't claim deployed or payout-verified based on a mock. Do not change settlement/contracts or enable real-money payouts. Finish VM deployment after the live service passes its tests, then connect the Vercel endpoints with the app owner.

## Committed baseline

- App PR #16 and Vercel deployment-preparation PR #17 are merged. Base main: `ef623a3640c0ea60718fbc7b741b561202cd4ab1`. Read current `apps/app` rather than older handoff patches.
- Worker PR #18: `3e89e755864c93bed6073abd5d3d9f9cd83123f4`, version `motion-experiment-0.3.2`. Source included here; 55 local tests passed before handoff. Four exercise selectors: squats, pushups, situps, jumping_jacks. This is a CLI, not a deployed HTTP/live service.
- Countdown PR #19: `22a65796ec8b5dd0d75e4cb140e6a77bcbe19475`. Source included in `packages/workout-prep`; 12 local controller tests passed before handoff. Expo component has not been tested on a physical device. There is no completed Expo app in this branch.
- User reported four actual squats in squats2.mov; v0.3.1 counted four. Same 15.8-second clip took 5.754 seconds without overlay versus 10.166 seconds in an earlier overlay run. These are user-run timings, not live latency or a controlled hardware benchmark.
- Pushups2: private CSV replay changed strict zero to flexible five candidate cycles. Full v0.3.2 video rerun has not been reported. Full-clip usable coverage remained 65.2%, so status still needs_retry. Never present this as verified form.
- All payout, identity, liveness, exercise-identity and form flags remain false. Estimated 3D joints do not guarantee every camera angle works. Situps/jumping jacks still need real-video validation.

## Milestones and acceptance

1. **Transport spike:** confirm Chert caller-video capture enabled, join one BYOR call, receive the correct caller audio/video, publish one audible cue back. Test mute, disconnect and cleanup. No counts yet. Deliver measured track format/orientation and a redacted transport report.
2. **Live counter:** feed latest frames into the existing warm model/counter with monotonic timestamps. Test repeated/dropped/out-of-order frames, brief occlusion, track replacement, side switches and second-person entry. Preserve CLI regressions. Count only after an eligible cycle; never synthesize reps across gaps.
3. **Coaching/interface:** phone setup, adjustable 7-second default countdown, readiness prompts, live candidate count, optional skeleton video, end-set summary. Validate five manually labeled pushups and four squats on a physical phone; add negative-motion controls. If counts disagree, diagnose rather than tune only to these clips.
4. **VM service:** implement bounded authenticated control API, service lifecycle, persistence, restart/cleanup and TLS. Deploy using the runbook and record release SHA, health evidence and rollback SHA. This milestone is NOT completed by this documentation.
5. **Vercel integration:** app owner implements session authorization and final-event handling from the contract. Exercise duplicate callbacks, retries, wrong-session events, timeout, backend outage and app backgrounding. No acceptance or payout conversion from experimental output.

Initial targets (not measured guarantees): one active call, 10 sampled frames/sec, bounded frame queue of one, p95 frame-to-count under 500 ms and count-to-audio under 1 second. Report capture/transport/inference/audio separately; lower frame sampling only after accuracy tests. Keep no raw recordings by default. A GPU purchase requires an actual CPU bottleneck measurement first.

## Access still needed locally

Existing laptop SSH access; Chert project/line with caller camera capture enabled and signed webhook configuration; LiveKit project credentials; a chosen worker TLS hostname; Vercel server environment access through the app owner. This cloud session has none of those secrets. Enter them through local/provider secret storage, never chat or Git. Chert and LiveKit are not assumed included in the $260 Vultr credits.
