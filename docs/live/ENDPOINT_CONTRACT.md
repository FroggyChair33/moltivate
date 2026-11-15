# Proposed Vercel–Vultr boundary

Version: draft 1. These routes are not implemented or deployed by this handoff. Agree on this contract with the app owner before wiring UI. Extend existing app conventions rather than creating a competing accounts/Web3 backend.

Implementation checkpoint, 2026-11-15. The loopback control API implements signed
POST /v1/sessions reservations, GET status, and POST end. End releases a
reservation only. Squats with policy claude-2d-primary-squat-v2 are the only
enabled exercise. expires_at is an integer Unix timestamp at most 600 seconds
ahead. Keys are configured as a JSON key-ID map in MOLTIVATE_COMMAND_KEYS.
Nonce and reservation state live in SQLite. Restart aborts reservations.
The response explicitly reports transport_ready=false and payout_eligible=false.
GET /healthz returns 200. GET /readyz returns 503 caller_pairing_pending.
Chert webhook verification, caller pairing, room/session binding, progress,
results and callback outbox remain unimplemented. Do not start app calls from
a successful reservation response until those gates are implemented.

## Routes

| Direction | Proposed route | Behavior |
| --- | --- | --- |
| Client → Vercel | POST `/api/workout-sessions` | Verify wallet login, membership, eligibility, deadline; derive user identity server-side; reserve worker capacity |
| Client → Vercel | GET `/api/workout-sessions/{id}` | Owner-authorized status and candidate count, no secrets or raw pose data |
| Client → Vercel | POST `/api/workout-sessions/{id}/end` | Idempotent authenticated stop |
| Vercel → VM | POST `/v1/sessions` | Validate signed request, policy and expiration; reserve one slot; return 202 or 409 busy |
| Vercel → VM | GET `/v1/sessions/{id}` | Signed status request; can poll during prototype |
| Vercel → VM | POST `/v1/sessions/{id}/end` | Signed, idempotent stop |
| Chert → VM | POST `/webhooks/chert` | Provider signature and event verification; timely BYOR decision; independently authenticated from Vercel |
| VM → Vercel | POST `/api/vision/events` | Signed progress/final event, deduplicate event ID and enforce per-session sequence |
| Operator | GET `/healthz`, `/readyz` | Minimal liveness; readiness reflects loaded model and configured transport, no secrets |

Start payload fields: `session_id`, `idempotency_key`, `membership_ref`, `exercise`, `policy_version`, `pushup_profile`, `prep_seconds`, `expires_at`. Vercel sets identity/policy/deadline; clamp prep to 1–60 seconds with default 7. Supported exercises are explicit enums. Do not accept arbitrary callback URLs or untrusted room names from the mobile client. Configure the one permitted Vercel callback origin on the VM. Session deadline uses wall time; motion dwell uses monotonic time.

## Service authentication

Internal contract proposal: TLS plus HMAC-SHA256 with separate command/event secrets. Headers `X-Moltivate-Key-Id`, `X-Moltivate-Timestamp` (Unix seconds), `X-Moltivate-Nonce`, and `X-Moltivate-Signature` (hex). Canonical string is `timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path + "\n" + lowercase_sha256(raw_body)`. Routes do not accept query parameters; GET signs empty bytes. Compare constant-time, allow at most 60 seconds clock skew, persist nonce use for at least 120 seconds. Validate limits before JSON decoding. Reject missing/invalid/replayed signatures with 401; reject altered payload with the same signature.

Retry with a fresh timestamp/nonce/signature while retaining the business idempotency key. Same key/same body returns the existing result; same key/different body returns 409. Signature authentication does not replace session authorization. Never expose these keys in `EXPO_PUBLIC_*`, `NEXT_PUBLIC_*`, logs, URLs or client bundles. Chert webhooks use Chert's configured signing scheme, not this proposal.

## Results and recovery

Event envelope: `event_id`, `session_id`, `sequence`, `event_type`, `occurred_at`, `worker_release`, `verifier_version`, `policy_version`, `payload`. Persist terminal result and delivery outbox before attempting callback. Use bounded exponential backoff and retry after restart. Vercel durably deduplicates before acknowledging. Polling must reconcile a lost callback. On restart, mark interrupted calls aborted; never reconstruct an unfinished rep from stale state.

Final payload must include exercise/profile, active-set start/end, complete/initial-partial counts, interruption count, active usable fraction, rejected reasons, sample rate, latency metrics, termination reason and flags:

```json
{
  "status": "experimental_only",
  "payout_eligible": false,
  "form_assessed": false,
  "identity_verified": false,
  "liveness_verified": false,
  "exercise_identity_verified": false
}
```

Use `needs_retry` for inadequate tracking and an explicit aborted/failed session state for interruption. Candidate counts can remain visible but are not accepted financial evidence. The server, never the client, decides future acceptance under a separately reviewed policy. Do not alter Anchor settlement while connecting this prototype.

## Required contract tests

Valid and invalid signatures; tampered body; expired timestamp; nonce replay; rotated key IDs; duplicate start/end/final events; conflicting idempotency key; wrong owner/session; late event after deadline; out-of-order progress; callback outage and replay; busy capacity; invalid exercise/prep; worker restart; real Chert track disconnect. No unauthorized request may create a LiveKit room or start processing.
