# Vultr deployment runbook

Status on 2026-11-15: CPU file processing has run on the user's VM. A live agent, authenticated control API, TLS endpoint and Vercel connection have **not** been deployed. This handoff branch contains the existing worker/countdown and deployment instructions; it does not contain a functioning live service entry point. Do not install an example systemd unit pointing at a nonexistent module.

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

Update this file with actual release SHA, hostname, service name, deployment time, health checks, real-call tracking/count/audio latency, callback acceptance evidence and rollback release SHA. A target such as p95 count latency under 500 ms is not a measured result.

Rollback: stop accepting new sessions, cleanly end the active call, switch to the previous known-good release and restart the service. Keep durable idempotency/outbox state; do not restore stale session state that could duplicate counts. Preserve old CLI directories throughout.

### Remaining external prerequisites

This cloud workspace has no SSH key, Vultr API credential, Chert line access or LiveKit secrets. The existing local Codex/laptop connection is the intended deployment executor. A live deployment cannot be verified here until that executor runs it and reports the evidence above.
