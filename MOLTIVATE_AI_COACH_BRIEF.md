# Moltivate — AI Workout Coach & Pose Verification

**Status:** Proposed implementation brief; capabilities and workout rules still need to be tested.  
**Prepared:** November 14, 2026  
**Goal:** Help people complete their workouts with a live skeleton overlay, rep counting, and useful coaching, while giving Moltivate a foundation for challenge verification.

## The idea

You prop your phone up, step into the frame, and start your set. Moltivate places dots on your joints and connects them into a moving stick figure. It tracks your movement, counts completed reps, and gives feedback when it can confidently identify an issue.

Chert could bring the conversational side to life: an AI coach you can talk to through FaceTime or message through iMessage. The experience should feel like someone helping you show up and finish your set.

The technology is **human pose estimation**, also called **skeletal tracking**. Gesture recognition can be built on top of the tracked movement.

## What each component does

| Component | Proposed responsibility |
| --- | --- |
| Phone camera and app UI | Guide camera placement, show the skeleton, display rep progress and tracking status. |
| MediaPipe Pose Landmarker | Estimate body landmarks from camera frames. |
| Exercise evaluator | Calculate joint angles and track movement phases using tested, exercise-specific rules. |
| Coaching agent | Turn structured exercise events into short, relevant spoken or written feedback. |
| Chert | Connect the agent to supported iMessage or FaceTime experiences. |
| Backend verifier | Independently evaluate challenge evidence and record accepted results. |
| Solana integration | Settle a challenge only after the backend authorizes its result. Keep the prototype on simulated balances or test funds. |

**Verified capability:** MediaPipe provides 33 estimated body landmarks, including image and 3D world coordinates, with visibility/presence information. These are inputs to our evaluator; they do not include a ready-made verdict that a workout was performed correctly. [1]

**Chert dependency:** Chert documents a FaceTime bridge to a LiveKit room we control. Caller-camera capture and outgoing agent video are separate capabilities. We must confirm caller-camera access on our assigned line and test the integration before promising a FaceTime workout coach. [2][3]

## Recommended first version

Build **one-person bodyweight squat tracking** with a documented camera position and full-body framing.

The MVP should include:

- Camera permission and a clear framing guide.
- A live skeleton overlay.
- Rep counting based on a complete movement sequence.
- A visible “tracking,” “reposition camera,” or “set complete” state.
- One useful cue at a time.
- A session summary with completed reps and any tracking gaps.
- A sample challenge result, clearly identified as a prototype.

Defer other exercises, crowded scenes, detailed hand gestures, and automatic real-money settlement until the first movement is tested.

## How a squat session works

1. **Frame and calibrate.** Confirm the required landmarks are visible and stable. Guide the person into the supported camera position and establish their starting pose.
2. **Track movement.** Follow the relevant hip, knee, ankle, and shoulder landmarks over time.
3. **Calculate useful measurements.** For example, the hip–knee–ankle angle describes knee flexion. Smooth noisy measurements without hiding sustained tracking failures.
4. **Follow the rep phases.** Track ready → lowering → bottom → rising → completed. Count once after a complete accepted sequence.
5. **Give feedback.** Publish a specific event when a tested rule is met or tracking needs correction.
6. **Finish the set.** Show accepted reps, tracking interruptions, and a clear next action.

For three landmarks A, B, and C, the angle at B can be calculated from the vectors A−B and C−B using their dot product. Guard against zero-length vectors and numerical rounding errors.

Use separate entry and exit thresholds, minimum phase durations, and a cooldown to prevent jitter from counting extra reps. Reset or suspend a rep after a substantial tracking gap.

**Do not choose one universal angle and call it “proper form.”** Rules need to account for the exercise, camera position, body proportions, and intended movement range. Validate them with qualified coaching input and representative recordings before using them to judge participants.

## Coaching behavior

The exercise evaluator should produce structured events such as:

- `tracking_lost`
- `camera_reposition_needed`
- `rep_completed`
- `movement_criterion_not_met`
- `set_completed`

The agent can translate these into natural feedback:

> “Move back a little—I can’t see your feet.”

> “That’s five completed reps. Five to go.”

> “Tracking dropped for that rep. Let’s reset.”

Keep feedback brief and rate-limited. The coach should explain the evaluator’s findings without inventing measurements or claiming a rep was accepted when the evaluator did not accept it.

A raised-hand gesture could later start a set. Require a deliberate hold and debounce it so normal exercise movement does not accidentally trigger controls.

## Chert integration plan

**Start with the in-app camera flow.** Keep the skeleton and immediate tracking feedback in Moltivate. A separate Chert integration could send reminders and session summaries through iMessage.

**Then test FaceTime coaching.** On a caller-video-enabled Chert line, investigate receiving the LiveKit video track in our processing service and returning spoken feedback through the agent. Confirm frame access, latency, and session cleanup with an actual call.

Do not assume a custom skeleton overlay can be drawn inside the caller’s native FaceTime UI. That display behavior needs its own integration check; the in-app overlay remains the simplest first implementation.

Questions to confirm with Chert:

- Does our assigned line support incoming caller-camera capture?
- Can our LiveKit agent subscribe to usable video frames and timestamps?
- What frame rate, resolution, and latency can we expect in practice?
- How should we feed structured workout events into the agent?
- What concurrency, usage, and session-duration limits apply?

## Verification and money

Keep coaching separate from challenge authorization.

Client-side rep counts provide immediate feedback, but users can modify client output. For a wager-backed challenge, the backend must independently evaluate trustworthy session evidence before approving a result. An uploaded landmark summary alone is not sufficient proof.

Bind evidence to the authenticated participant, challenge, and session. Track evaluator versions, timestamps, and duplicate submissions. Pose estimation alone does not establish identity or prevent replayed videos; those require separate checks.

When confidence is low, return **“unable to verify—retry”**. Do not silently count the rep or automatically penalize the participant.

If independent verification and anti-replay checks are unfinished, keep the demonstration on simulated balances or test funds.

## Accuracy and privacy boundaries

A single camera estimates depth. Occlusion, poor lighting, framing, and orientation can degrade tracking. The model’s own documentation describes these limitations. We can assess selected movement criteria; we cannot guarantee complete or safe technique from a skeleton overlay. [4]

Request camera access only when needed. Prefer local processing for immediate feedback. Explain any video transmission or retention needed for server verification, and avoid keeping raw video by default. Keep provider credentials on the server.

## Suggested build order

1. **Vision/UI:** Camera preview, landmark overlay, framing feedback.
2. **Exercise logic:** Squat phase tracking, rep counting, confidence handling.
3. **Validation:** Test full reps, partial reps, pauses, occlusion, different bodies, clothing, lighting, and camera positions.
4. **Backend:** Session records and independently verified sample results.
5. **Chert:** Confirm access, then connect structured events to the coaching conversation.
6. **Demo polish:** Clear start/end states, concise feedback, and a readable challenge summary.

Before calling the MVP ready, confirm that tracking loss cannot award a rep, pauses cannot duplicate reps, and repeated submissions cannot duplicate a result. Measure false accepts and false rejects against manually labeled clips. Record actual results rather than advertising an unmeasured accuracy percentage.

## Primary references

Sources checked November 14, 2026.

[1]: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
[2]: https://www.trychert.com/facetime
[3]: https://docs.trychert.com/facetime-cli/quickstart
[4]: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf

- [Google MediaPipe Pose Landmarker][1] — landmark outputs and supported platforms.
- [Chert FaceTime][2] — LiveKit integration and caller-camera capability requirements.
- [Chert setup guide][3] — assigned lines and real-call testing.
- [BlazePose GHUM model card][4] — intended uses, depth estimates, and tracking limitations.

