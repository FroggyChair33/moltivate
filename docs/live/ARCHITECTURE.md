# Live video and coaching architecture

Status: implementation plan; the included worker processes files today. The user chose Expo for the eventual native client, Vercel for the general/Web3 backend, and the existing Vultr VM for long-running vision/coaching. Preserve the existing Next.js app while the native client is built separately.

| Owner | Responsibility |
| --- | --- |
| Expo or existing app UI | Authentication, challenge selection, session start/status/end; in-app camera countdown when using that capture path |
| Vercel / existing app owner | Authenticated membership and eligibility, session IDs/deadlines, durable results, Web3 rules and server secrets |
| Vultr / vision owner | Narrow session-control API, warm MediaPipe model, LiveKit agent, counter, coaching audio, skeleton output, disconnect cleanup |
| Chert managed service | Provisioned FaceTime endpoint and bridge into our LiveKit room; caller capture must be separately confirmed |
| LiveKit project | RTC room transport between Chert and our agent; start with managed transport rather than hosting another media server on this VM |

**Vultr hosts our Chert-connected agent, not Apple's FaceTime client or Chert's managed bridge.** Do not assume that installing a Python package on Ubuntu supplies a FaceTime number or caller-camera access. Chert's separate open-source computer connector is not the default deployment path here.

## Call sequence

1. Vercel authenticates the user and creates a short-lived workout session bound to membership, exercise and policy. Reserve the single available line/VM capacity. Have the authenticated user confirm a one-time pairing challenge; caller handle alone is not wallet identity or proof of liveness.
2. Prewarm the agent and room before the Chert inbound decision. In `customer_decides` mode, verify the configured webhook signature against the raw body. Deduplicate events. Unpaired calls are rejected. Do not wait for model initialization inside the default roughly five-second decision window.
3. Reply to the valid call decision using Chert's documented accept payload: `action`, `livekit_url`, `participant_token`, `remote_participant_identity`. Mint a separate, short-lived bridge token with the exact room and unique bridge identity; never send a LiveKit API secret. Follow Chert's current token grants and expiration requirements.
4. Register track handlers before joining. Subscribe only to the expected bridge participant's caller tracks (`facetime-remote-video` / `facetime-remote-audio`, confirmed during spike). Ignore our own skeleton track and all unrelated participants. Handle publish/unpublish/mute and reconnect explicitly.
5. Publish one eligible agent audio track. Chert's audio-ready behavior requires agent audio even for video. Avoid a second bot publishing audio. Inspect the actual caller feed: it may contain FaceTime controls, names and a self-preview, so validate the caller ROI and orientation before inference.
6. Coach asks the person to frame their whole body, observes stable ready posture, then runs the selected countdown. Start a distinct active-set window after readiness and countdown. During FaceTime, the VM owns these spoken cues; Expo cannot put a custom countdown over Apple's FaceTime UI. In the separate in-app capture path, use the Expo preparation component.
7. Count and speak candidate repetitions, publish optional annotated video back as the agent camera, and send small status events. End at stop, deadline or disconnect. Finalize once, send a durable result callback, close the room/agent and release capacity.

## Frame and coaching pipeline

- Use LiveKit RTC raw frames, not an LLM's intermittent vision snapshots. Preserve aspect ratio, rotation and timestamps. Convert to the worker's expected RGB format once; do not stretch portrait frames to a square.
- Keep one warm CPU model per active session. Use a bounded latest-frame queue and a separate inference execution context so model work cannot block RTC/audio or webhook response handling. Drop stale frames rather than growing latency; report dropped-frame counts.
- Preserve elapsed-time dwell logic and tracking-gap resets. Do not duplicate frames to simulate 10 fps or fabricate continuity. Disconnect/track identity changes reset unfinished movement and require readiness again.
- Reuse current flexible pushup profile: top 145 degrees / 0.10 s, bottom 100 degrees / 0.15 s; strict profile remains selectable. Retain posture/confidence checks. Make policy/profile visible in results; do not silently loosen it per frame.
- Separate `preparing`, `countdown`, `active`, `paused`, `ending`, `ended` states. Keep setup/exit coverage separate from active-set coverage. This fixes the denominator only through an explicit session boundary; do not automatically trim away bad frames within a set.
- Start with deterministic cues and pre-generated/licensed audio or a measured TTS provider: countdown, counts, whole-body framing, tracking lost, set complete. Use cooldowns and deduplicated rep event IDs; cancel stale speech on disconnect. An LLM may later phrase conversational guidance, but never decides counts or claims proper form from unavailable evidence.
- The skeleton view is an optional outgoing agent video track. Render at a separately bounded rate; measure its CPU/latency cost. Verify its actual appearance on FaceTime rather than assuming it behaves like an Expo overlay.
- Do not record calls by default. Debug recording requires consent, explicit retention and private storage; never commit user video/pose CSVs.

## Existing constraints

The 2-vCPU / 4-GB VM starts at one call. One Chert line is not assumed to accept concurrent calls. Busy responses should be explicit, with no indefinite queue. Counter output stays experimental, with all trust flags false. The app must not map it to accepted workouts or settlement automatically. Chert transport and a pairing code do not establish exercise identity or liveness.

## References checked 2026-11-15

- [Chert audio/video](https://docs.trychert.com/facetime/audio-video) and [BYOR](https://docs.trychert.com/facetime/bring-your-own-room). Markdown endpoints at those URLs plus `.md` were readable during preparation. Confirm the exact webhook signing protocol before implementing; do not substitute our internal HMAC scheme.
- [LiveKit Python VideoStream](https://docs.livekit.io/reference/python/livekit/rtc/video_stream.html).
- [Vercel function limits](https://vercel.com/docs/functions/limitations). Keep ongoing RTC/inference on Vultr; Vercel requests only exchange small control/result messages.
