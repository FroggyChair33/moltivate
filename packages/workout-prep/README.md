# Workout preparation countdown (Expo integration component)

Default **7 → 6 → 5 → 4 → 3 → 2 → 1**, then a camera start request. Presets:
3, 5, 7, 10, 15 and 30 seconds; custom whole seconds from 1 to 60. Spoken cues
default on, with an accessible visual countdown and an audio switch. A preview
may be visible during preparation, but recording must begin only after countdown.

This is isolated source for the user's Expo/React Native app agent to integrate.
The checked-in root HANDOFF.md still describes Next.js app work and PR #16.
The user's newer instruction establishes Expo as the intended native target;
there is no Expo screen in this checkout to wire this into. No app, API, contract,
vision-worker or root dependency files are changed by this component.

## Ownership: app repo, executed on the phone

The preparation countdown belongs to the **Expo camera screen in the main app
repository**, not the Vultr vision worker or a backend request handler. It runs
locally on the phone so connectivity and server queueing cannot affect its timing.
The isolated package here can be merged and integrated by the app agent.

| Layer | Responsibility |
| --- | --- |
| Expo app | Select/persist preparation delay, show/speak countdown, cancel safely, start camera capture after countdown |
| General backend | Authenticate session, authorize challenge entry, accept upload/job and return processing status/results |
| Vultr worker | Analyze captured workout frames; never sleep for the preparation countdown |

Session authorization may happen before preparation, but workout duration and
video timestamps begin at actual recording, not at the first countdown cue.
If an existing challenge has a server deadline, the backend must still enforce
it independently; the local timer cannot extend eligibility. Store a preferred
delay locally (optionally sync to the user's profile); no per-second backend
calls, VM timers, or extra VM compute are needed for this feature.

## Integration

Copy `WorkoutPrep.jsx` and `countdown.mjs` together into the actual Expo app, or
import them from this folder if that app's Metro configuration supports it.
Inside that app, install the SDK-compatible speech module:

```bash
npx expo install expo-speech
```

Mount the component on the workout camera screen. Pass:

| Prop | Contract |
| --- | --- |
| `cameraReady` | True after permission/initialization; remain true during normal capture, false only if camera availability is lost |
| `screenActive` | Navigation focus; default true, but explicitly wire it to screen focus |
| `onStartRecording(signal)` | Promise resolving when recording actually starts; reject on start failure; honor cancellation |
| `initialSeconds` | Optional saved preference; defaults to 7 |
| `onDurationChange(seconds)` | Optional callback for the app to persist the preference |
| `onPhaseChange(phase)` | `idle`, `counting`, `starting`, `recording`, `error` |

**The recording adapter is intentionally not implemented here.** It must use
the actual camera library in the app. Do not directly pass `CameraView.recordAsync`:
that promise returns the finished file, not a recording-start acknowledgement.
Use the camera integration's reliable start signal, or provide a deliberate
camera-specific start adapter with its behavior tested on devices. Only then
should the component display/speak “Go”. The adapter must handle an abort even
if the underlying camera starts late, stop/discard that capture, and remove its
abort listener when capture finishes. Do not treat elapsed countdown time as
proof that video capture started.

Keep this component mounted through capture so its AbortSignal remains alive;
the parent can hide its panel once `onPhaseChange` reports `recording`. The
parent owns the recording screen, Stop button, file, upload and session lifecycle.
After capture has finished or been discarded, remount with a new React `key`
for the next set. Avoid mounting multiple active countdowns/speech owners.

Only call the worker with the captured workout, excluding preparation time.
This component does not start/credit a workout session, validate body position,
authorize payouts or claim that all joints are visible. A later positioning
check can keep `cameraReady` false until framing is adequate, but that check is
not implemented by this countdown.

## Cancellation and timing

The timer uses elapsed monotonic time, not repeated subtraction. Duplicate
start taps are ignored. Cancel, screen blur, loss of camera readiness, inactive/
background AppState, Android notification shade blur, or component unmount
cancel the attempt. Coming back never restarts it automatically. A JS scheduling
gap over 1.5 seconds also cancels, rather than unexpectedly skipping to capture.
Late promises from canceled attempts cannot change the new attempt's state.

Speech queues are cleared on each new cue and cancellation. On physical iPhones,
Expo Speech is silent in silent mode; the panel explains this when audio is on.
Coordinate speech ownership with the coaching/audio integration. Countdown
speech isn't a timing source and speech synthesis may be delayed on a device.

## Validation

```bash
node --test packages/workout-prep/tests/*.test.mjs
```

12 controller tests cover exact countdown, bounded input, duplicate taps, timer
drift, camera readiness, cancellation, suspension, unmount, start failure, late
callbacks and retry isolation. JSX is syntax-bundled separately with React,
React Native and Expo Speech externalized. Neither proves physical camera or
audio behavior. No native app build, rendered-device UI test, or app integration
has been performed because the target Expo app is not in this checkout.

Before shipping, the app agent should test iOS and Android on physical phones:
7-second and custom starts, camera permission denial, start failure, cancel at
one second, rapid taps, background/return, notification shade, screen navigation,
sound/silent mode, screen-reader feedback, large text and a second set. Verify
that capture starts once, preparation footage is excluded, and canceled captures
are stopped and discarded by the recording adapter.

References: [Expo Speech](https://docs.expo.dev/versions/latest/sdk/speech/),
[React Native AppState](https://reactnative.dev/docs/appstate),
[Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/).
