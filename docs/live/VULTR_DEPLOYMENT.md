# Vultr deployment runbook

Status on 2026-11-15: CPU file processing has run on the user's VM. A live agent, authenticated control API, TLS endpoint and Vercel connection have **not** been deployed. This branch includes a manual transport probe. The full live coaching service still needs implementation, real-phone validation and deployment.

## Existing machine and access

Ubuntu 24.04, 2 vCPU, 4 GB RAM, 128 GB NVMe; `moltivate-vision-01`, `96.30.205.18`. Initial credit budget $260; current remaining credit unknown. Use CPU first. Do not provision a GPU or a second VM for this milestone.

Run this in **Windows PowerShell on Adhi's laptop**, not inside SSH:

```powershell
ssh -i "$env:USERPROFILE\.ssh\moltivate_vultr" moltivate@96.30.205.18
```

The existing firewall permits SSH from the user's public IP. If it changed, update that narrow rule through Vultr; do not open SSH globally. Closing a terminal does not stop the server. Do not expose private key or password contents to an agent transcript.

## Prepare an isolated checkout on the VM

Preserve both `~/moltivate-vision` and `~/moltivate-worker-v03` and their videos/results. Check directory existence before cloning; if `~/moltivate-live` exists, inspect its status rather than overwriting it.

```bash
git clone --branch codex/live-coaching-handoff --single-branch \
  https://github.com/betrji/moltivate.git ~/moltivate-live
cd ~/moltivate-live
bash ops/vultr/preflight.sh
```

The preflight is read-only and reports installed prerequisites. Missing packages should be installed with apt after checking current state: `python3-venv`, `ffmpeg`, `git`, and system libraries required by the existing worker bootstrap. Run the existing bootstrap only when needed:

```bash
cd ~/moltivate-live/services/vision-worker
bash bootstrap.sh
source .venv/bin/activate
python -m unittest discover -s tests -v
python moltivate_motion.py --help
```

The bootstrap installs locked dependencies and verifies the official lite model checksum. It does not configure Chert or start a live service. Keep original media in its existing private directory; use an absolute input path for a regression run and a new output directory. Do not upload media to GitHub.

## One-call transport check

The transport probe joins named LiveKit dispatches, consumes only the
expected Chert bridge tracks, publishes a deterministic tone, and exits on
bridge disconnect or a two-minute test timeout. It writes no media files and
does no inference. Use this manual check before exposing any control API.

1. In the [Chert app](https://app.trychert.com), sign in, verify the phone,
   and request a line if the project has none. In the [FaceTime dashboard](https://facetime.trychert.com),
   select **Workers & Lines** and confirm one assigned online FaceTime Video
   line, **customer decides**, and no default hosted Assistant. Ask Chert to
   confirm that caller-camera capture is enabled for the assigned worker
   profile if there is no self-service capture setting. See [Projects and
   lines](https://docs.trychert.com/facetime-cli/connect) and [Caller
   vision](https://docs.trychert.com/facetime-cli/video).
2. On the VM, put only `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
   `LIVEKIT_API_SECRET` in `~/.config/moltivate-live/transport.env`
   with mode `0600`. The URL uses the project's `wss://` endpoint. Use
   the same LiveKit project in both terminals. No OpenAI key is needed.
3. In SSH terminal A, start the probe from the isolated checkout.

   ```bash
   cd ~/moltivate-live
   set -a
   . ~/.config/moltivate-live/transport.env
   set +a
   .transport-venv/bin/python services/vision-worker/transport_probe.py start
   ```

   For a fresh transport environment, create it with
   `python3 -m venv .transport-venv` from the checkout root and install
   `.transport-venv/bin/python -m pip install -r services/vision-worker/transport.requirements.lock.txt`.

4. In SSH terminal B, approve Chert sign-in for the intended project and
   check the line. Start the documented named-agent BYOR connector for a
   short slot. No inbound webhook is needed for this diagnostic.

   ```bash
   conf="$HOME/.config/moltivate-live"
   export PATH="$conf/toolchain/node-v24.22.1-linux-x64/bin:$PATH"
   chert="$conf/connector/node_modules/.bin/chert"
   "$chert" login --device
   "$chert" doctor --env-file "$conf/transport.env"
   "$chert" dev --agent moltivate-transport --env-file "$conf/transport.env" --minutes 5
   ```

5. Call the assigned address using **FaceTime Video** on a real iPhone.
   Turn on the camera and change the view. Confirm the agent logs
   `caller frame received` with format, dimensions, and rotation, then
   `caller video frames changed`. Say a word to exercise the microphone.
   Confirm the caller hears a test tone. Hang up and verify **both** the
   probe's `transport media cleanup complete` and connector room cleanup.
   Stop the connector first, wait for line release, then stop the probe.

### Transport evidence

SSH, preflight and `pip check` passed. A temporary LiveKit 1.13.11 server
on Vultr delivered synthetic 64×96 video and mono caller audio to the probe,
returned a non-silent cue, and showed the agent leaving after the peer
disconnected. The temporary server and agent were stopped. The synthetic
room was deleted.

- On 2026-11-15, a real iPhone placed one inbound FaceTime Video call through
  Chert CLI `0.1.0-beta.21` to the Vultr probe at `6fdbb57`. Chert reported
  acceptance in 0.1 s. That measures the call decision.
- The probe received changing 1280×720 frames with rotation 0 and a 48 kHz
  mono caller audio track. The caller confirmed hearing the generated tone.
- After hangup, both caller tracks unsubscribed, the bridge disconnected,
  and the probe logged media cleanup. Chert reported the call ended and
  briefly reported no warm agent before confirming a replacement waiting
  room. Verify readiness again before a second call.
- End-to-end audio and count latency remain unmeasured. This was a manual
  transport test. Persistent service, HTTPS and Vercel integration are
  pending.


## Manual live rep test

On Vultr, bootstrap `services/vision-worker` so its `.venv` and checksum-verified
lite model are installed. The transport environment and pose environment stay
separate. FFmpeg must include its `flite` filter for offline speech.

Use the transport test commands above, adding this setting in terminal A
before starting the probe:

```bash
export MOLTIVATE_LIVE_EXERCISE=squats
```

Alternatively set the value to `pushups` and restart the manual probe before
opening a new call window. Pushups use the existing flexible policy. The default
preparation delay is seven seconds and the active set is 35 seconds. Optional
operator settings are `MOLTIVATE_PREP_SECONDS` (1–60) and `MOLTIVATE_SET_SECONDS`
(15–60), both whole seconds.

Live squats use the normalized 2D left hip–knee–ankle angle from Claude
co-authored commit `cc16424`. The angle must go below 110° and return above
160°. The live adapter requires observable joints and clears an unfinished
rep after lost tracking. Stand side-on with your left side toward the camera.
The squat counter uses torso position and scale to follow the primary person.
It skips clear secondary poses, such as a small preview, and clears unfinished
reps when it cannot confidently match the primary pose.

Wait for Chert’s waiting-room message, then call with FaceTime Video. Prop the
phone level and side-on with the whole body visible. Hold upright for squats,
or hold the top position for pushups. Wait for “Go”, perform three controlled
reps with a brief hold at both endpoints, and compare the spoken numbers with
your manual count. End by hanging up. Read the experimental result and confirm
media cleanup and release of the line. The spoken cues use FFmpeg/Flite's
offline female `slt` voice. The countdown can tolerate up to a second of
brief tracking loss. Hold the starting position with head, hands, and feet
inside the frame to start the countdown. The agent checks framing and starting
position again before “Go” and begins counting in the active set.

The probe samples fresh frames, preserves aspect ratio, applies RTC rotation,
and resets unfinished movement when video is muted, replaced, or interrupted.
It reports aggregate counts and tracking reasons without recording media.
The manual test produces no accepted workouts or payouts. Skeleton overlay and
service/API deployment are separate milestones.

On 2026-11-15, the FaceTime test with `827ad0f` counted seven squats and the
caller confirmed seven. The active set analyzed 259 frames, with 83.8% usable
coverage and one tracking interruption. MediaPipe reported multiple poses in
nine frames, so the result was `needs_retry` and payout-ineligible. The call
ended and the agent logged cleanup. A LiveKit mute event exposed an argument
order error. The corrected handler passed a synthetic mute and unmute test
on Vultr. Real-phone pushups and end-to-end latency remain unmeasured.

## Finish deployment after the live agent is implemented

Local Codex must carry out these steps, not merely mark this checklist complete:

1. Finish transport and counter milestones in CODEX_START.md. Pin LiveKit/control-API dependencies in the worker environment after compatibility testing; preserve the working MediaPipe pin and baseline tests. Record the actual service module/command.
2. Configure Chert managed BYOR with caller-video capture enabled. Create a LiveKit project, room-token policy and the agent/bridge identities. Enable Chert webhook signing and implement the exact documented validation. Verify a real call before full app wiring.
3. Keep runtime secrets in a root-owned `0600` environment file such as `/etc/moltivate-vision.env`, readable by systemd at service startup, or equivalent secret manager. Names to define in the implementation: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CHERT_API_KEY`, `CHERT_WEBHOOK_SECRET`, `MOLTIVATE_COMMAND_SECRET`, `MOLTIVATE_EVENT_SECRET`, `MOLTIVATE_CALLBACK_URL`. Use a dedicated non-login service account and restricted private state directory. No secrets in command-line arguments.
4. Deploy a pinned, tested commit into a new release directory; keep the previous release for rollback. Create a real systemd unit for the implemented entry point, running unprivileged, bound to loopback (for example port 8080), `Restart=on-failure`, controlled shutdown, writable state only where required. Set one active session and measured memory limits. Enable only after manual localhost smoke testing.
5. Choose a worker subdomain with the user/app owner, point its A record to `96.30.205.18`, and terminate HTTPS through Caddy or another maintained proxy. Do not reuse the apex/www marketing records. Configure certificates before sending provider webhooks. Firewall: public HTTPS, port 80 only if required for certificate issuance; SSH remains source-restricted; no public port 8080. Managed LiveKit transport does not require exposing a self-hosted SFU port range on this VM.
6. Verify liveness/readiness via the real domain; send valid and invalid signed requests; test provider signature rejection. Reboot/restart and confirm recovery, no orphan sessions and no duplicate events. Redact logs and tokens. Verify room/audio cleanup on stop and timeout.
7. Give the app owner the confirmed HTTPS base URL and contract version; provision internal secrets separately into Vercel server-only environment variables. Implement the Vercel routes and database authorization/idempotency, deploy, then run one full authenticated real-phone session. A Chert webhook success alone is not end-to-end integration.

## Deployment record required

2026-11-15 service checkpoint. User systemd units moltivate-agent.service and
moltivate-control.service run from ~/moltivate-live as the existing unprivileged
moltivate account. Both are enabled and passed restart checks. The control API
listens on 127.0.0.1:8080 only. Unsigned start returned 401; signed start/status/end
returned 202/200/200. Authentication/replay and durable reservation tests passed
using .transport-venv (aiohttp is already pinned in its lockfile).

Private command keys were generated on the VM in
~/.config/moltivate-live/control.env, mode 600. Durable state is under
~/.local/state/moltivate-live. Never put these command keys in browser settings.
The coach uses the existing private transport.env and natural voice cache.
This remains a reservation-only API. /readyz intentionally reports 503.

The existing SSH account is used for this increment. Dedicated service-account
isolation, pinned release directories, HTTPS hostname/certificate, a real reboot test (linger is enabled), Chert caller pairing and callbacks
remain pending. The persistent agent does not persist the expiring Chert CLI
test binding. No always-on FaceTime routing is claimed.

Operator checks:

```bash
systemctl --user status moltivate-agent moltivate-control
curl -fsS http://127.0.0.1:8080/healthz
systemctl --user restart moltivate-agent moltivate-control
```

To withdraw this increment, stop and disable moltivate-control and
moltivate-agent with systemctl --user. Preserve the SQLite state and private
configuration. Manual phone testing can resume from the prior tested coach
release 6ba0f17 once a fresh Chert slot is opened.

Update this file with actual release SHA, hostname, service name, deployment time, health checks, real-call tracking/count/audio latency, callback acceptance evidence and rollback release SHA. A target such as p95 count latency under 500 ms is not a measured result.

Rollback: stop accepting new sessions, cleanly end the active call, switch to the previous known-good release and restart the service. Keep durable idempotency/outbox state; do not restore stale session state that could duplicate counts. Preserve old CLI directories throughout.

### Remaining external prerequisites

The laptop SSH route passed preflight. Repeat phone tests use the assigned
Chert line with caller capture and the private LiveKit configuration on
Vultr. Production HTTPS and Vercel integration require a worker hostname
and coordination with the app owner.
