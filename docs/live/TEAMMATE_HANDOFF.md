# Mobile web app and Vultr integration handoff

Updated November 15, 2026. This is for the app owner coordinating with the
Vultr operator. Read CODEX_START.md and ENDPOINT_CONTRACT.md alongside this file.

## What is running

Vultr VM moltivate-vision-01 at 96.30.205.18 runs two user systemd services under
the existing unprivileged moltivate account. Both are enabled and active.
Linger=yes was verified, allowing the user services to survive logout and start
at boot. Service restart passed. A machine reboot has not been tested.

- moltivate-agent runs the LiveKit squat coach with the natural coral voice.
- moltivate-control listens on 127.0.0.1:8080 and implements signed reservations.

The source branch is codex/live-coach-transport in betrji/moltivate. Service/API
implementation commit is f830fe2. The latest phone-tested coach is 6ba0f17.
Code runs from ~/moltivate-live using .transport-venv, with MediaPipe isolated in
services/vision-worker/.venv. Preserve ~/moltivate-vision and
~/moltivate-worker-v03 and their private recordings/results.

## Teammate work

1. Select a dedicated worker hostname under a domain you control. Point its DNS
   A record to 96.30.205.18. Avoid changing apex/www marketing records.
2. Coordinate with the Vultr operator to install a TLS reverse proxy. Proxy the
   worker hostname to 127.0.0.1:8080. Keep 8080 private. Verify certificate,
   /healthz and signed requests from outside the VM. The current /readyz
   deliberately returns 503 caller_pairing_pending.
3. Agree on ENDPOINT_CONTRACT.md before implementing the Vercel adapter. Vercel
   must validate wallet login, membership, policy and deadlines. Browser code
   must never possess worker signing keys.
4. Complete caller pairing, authenticated Chert BYOR decisions and binding of
   the Vercel session ID to the actual LiveKit call. An authenticated reservation
   currently does not start or authorize a FaceTime call.
5. Add durable progress/final results and a callback outbox with retry,
   deduplication and restart recovery. Then connect the mobile web UI to Vercel
   start/status/end routes and validate an authorized phone session end to end.

## Current API behavior

The implemented routes are POST /v1/sessions, GET /v1/sessions/{id} and
POST /v1/sessions/{id}/end. They reserve/read/release one slot only. The response
always includes transport_ready=false and payout_eligible=false. Stop does not
yet disconnect a live call. Reservations are aborted on API restart and expire
on subsequent authenticated requests.

Start JSON has session_id, idempotency_key, membership_ref, exercise,
policy_version, expires_at and optional prep_seconds. Only squats and policy
claude-2d-primary-squat-v2 are enabled. expires_at is Unix seconds, within the
next 600 seconds. prep_seconds defaults to 7 and accepts integers 1–60.
pushup_profile may be omitted or null.

Use the HMAC headers and raw-body canonicalization in ENDPOINT_CONTRACT.md.
GET signs an empty body. End also uses an empty body. Retrying uses a fresh
timestamp and nonce while preserving the exact request bytes and idempotency
key. Same key/different bytes returns 409. Replay/invalid signatures return 401.
Capacity conflicts return 409. Durable nonces and reservations use SQLite.

The VM generates and stores signing keys privately in
~/.config/moltivate-live/control.env, mode 600. MOLTIVATE_COMMAND_KEYS is a JSON
map of key IDs to secrets. The operator should provision the agreed command key
into server-only Vercel environment settings through a private channel. Do not
copy credentials into this document, Git, chat, URLs or NEXT_PUBLIC variables.
LiveKit/OpenAI configuration remains in transport.env. Event signing keys and
callback origin still need provisioning when callbacks are implemented.

## FaceTime and test evidence

Chert project 6aa9253b-e3c6-4c07-8b56-498b3ed83314 has the existing
staymoltivated line +1 (206) 465-5399. Reuse this project and line.
The Chert CLI test binding expires after five minutes. Running the agent as a
service alone does not make the line permanently route to it.

The last caller performed six squats and heard six. Processing averaged
13.9 fps. Countdown speech-ready delays were 22–36 ms with all numbers present.
Rep speech-ready delays were 20–37 ms. These exclude FaceTime delivery and
playback latency. The final summary needed 1.42 seconds to generate.
Usable coverage was 61.8%, so quality status remained needs_retry. Counts must
remain experimental and payout-ineligible. Do not change settlement/Anchor.

The worker suite passed 67 tests. The transport environment separately passed
two HTTP regression tests covering signatures, tampering, timestamp expiry,
nonce replay, capacity, duplicate requests, stop and restart. Installed service
smoke returned 401 for unsigned start, 202 for signed start, and 200 for status
and end. LiveKit synthetic audio and disconnect cleanup passed. HTTPS, provider
webhook signatures, pairing, callbacks and app authorization remain unverified.

## Operator commands

```bash
systemctl --user status moltivate-agent moltivate-control
systemctl --user restart moltivate-agent moltivate-control
loginctl show-user moltivate -p Linger
curl -fsS http://127.0.0.1:8080/healthz
cd ~/moltivate-live
PYTHONPATH=services/vision-worker .transport-venv/bin/python -m unittest discover -s services/vision-worker/tests -p test_control_api.py
```

Use the MediaPipe environment for the existing vision tests and the transport
environment for control API tests. The latter requires its pinned aiohttp.
Avoid running the whole mixed test directory in the MediaPipe environment.

For rollback, stop/disable the two user services before changing code. Preserve
~/.local/state/moltivate-live and private configuration. Restore the intended
tested release and restart. Dedicated release directories, a separate non-login
service account and public TLS remain deployment work.
