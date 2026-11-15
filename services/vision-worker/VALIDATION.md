# Validation record — motion-experiment-0.3.0

Implemented for the November 15, 2026 Moltivate worker increment. These checks
ran on the implementation host, not on the user's Vultr VM.

| Check | Observed result | What it establishes |
| --- | --- | --- |
| `python -m unittest discover -s tests -v` | 32 passed, 0 skipped | Synthetic geometry/state rules and real FFmpeg media handling |
| Python compilation and Bash syntax | Passed | Sources and setup script parse |
| Locked environment `pip check` | No broken requirements | Installed dependency compatibility |
| Two-second portrait blank H.264 MOV, real MediaPipe CPU, overlay enabled | 20 frames, 0 detected, 0 cycles, `needs_retry` | Decode → inference → diagnostics → overlay failure path works |
| Official MediaPipe pose image repeated as a two-second H.264 MP4 | 20/20 usable frames, right side selected, 0 complete cycles | Real landmarks and estimated 3D flow through the worker; static pose doesn't produce repetitions |
| Skeleton overlay inspected | 640×640, 20 frames, two seconds, skeleton follows visible body | Artifact rendering and preserved display proportions on the smoke fixture |
| Rounded original squat angle trace supplied in chat | 3 complete cycles + 1 initial partial | Counter regression only; not a new inference run on that video |

The 32 automated checks include all four movement endpoint definitions,
mirroring, synthetic camera yaw, end-on rejection, 3D angle rotation invariance,
standing/arm-only negative controls, side locking and reacquisition, tracking
gaps, initial/unfinished cycles, endpoint jitter, holds, timestamp validation,
multiple-person handling, low-coverage retries, existing-output preservation,
MOV rotation, H.264 and HEVC decoding, malformed/empty files and duration limits.

## Reproduction environment

- Linux x86_64, Debian 13 implementation host, Python 3.12.14.
- `requirements.lock.txt` installed; MediaPipe 0.10.21, NumPy 1.26.4.
- CPU delegate explicitly selected; no GPU inference.
- Official pose-landmarker-lite float16 model, version 1, SHA-256
  `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.
- Public smoke input source:
  `https://storage.googleapis.com/mediapipe-assets/pose.jpg`.
  Downloaded only for local testing; neither it nor its derivatives are committed.
- Native inference emitted GPU-unavailable, feedback-manager and NORM_RECT
  warnings. The CPU jobs completed and the inspected skeleton aligned on the
  smoke fixture. This does not validate every camera/crop configuration.

## What is not established

No labeled moving exercise footage was available locally. The user's original
MP4 and newer MOV clips remain on Vultr; their pasted v0.2 results are historical
evidence only. Accuracy, false acceptance, occlusion tolerance, front/side/oblique
performance, unusual body proportions, lighting, iPhone HDR color and realistic
concurrent capacity are unmeasured for v0.3. Synthetic rotations do not prove
real-camera invariance. Motion results remain experimental and payout-ineligible.

Next: install alongside v0.2, inspect overlays and CSV for the original squat,
the failed MOV and standing control, then collect known-count clips for push-ups,
sit-ups and jumping jacks. Include off-angle, cropped and non-exercise controls.
Report counts, partials, usable coverage and errors per clip before changing
thresholds or integrating acceptance into the app.
