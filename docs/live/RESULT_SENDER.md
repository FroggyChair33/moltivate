# Vision result sender

The worker sends terminal events to the backend's `POST /api/vision/events`.
The sender persists the exact request body in SQLite before delivery. Retries
retain the event ID, sequence and body, with a fresh timestamp, nonce and HMAC.
It checks the acknowledgement against the event ID and sequence. Network
errors, HTTP 408/429 and server errors retry with backoff capped at one hour.
Other HTTP 3xx and 4xx responses leave a failed row for operator review.

The caller-pairing implementation should pass the verified app session ID to
`LiveProbe.close(paired_session_id=..., termination_reason=...)`. Manual
diagnostic calls omit that argument. The current callback workflow sends only
one terminal event per session, using sequence 1.

## Example for the backend owner

```json
{
  "event_id": "e45c940ecc1c4d0a8f20588898e816a1",
  "session_id": "example-paired-session",
  "sequence": 1,
  "event_type": "final",
  "occurred_at": "2026-11-15T08:17:57+00:00",
  "worker_release": "example-release",
  "policy_version": "claude-2d-primary-squat-v2",
  "payload": {
    "phase": "ended",
    "exercise": "squats",
    "policy": "claude-2d-primary-squat-v2",
    "termination_reason": "disconnected",
    "count": 6,
    "complete_cycles": 6,
    "frames_analyzed": 487,
    "usable_fraction": 0.618,
    "tracking_interruptions": 1,
    "ignored_secondary_pose_frames": 6,
    "dropped_frames": 54,
    "rejected_frame_reasons": {
      "joints_out_of_frame": 5,
      "low_landmark_confidence": 9,
      "multiple_people_detected": 78,
      "no_person_detected": 94
    },
    "retry_reasons": ["insufficient_tracking_coverage", "multiple_people_in_set"],
    "status": "needs_retry",
    "payout_eligible": false,
    "form_assessed": false,
    "identity_verified": false,
    "liveness_verified": false,
    "exercise_identity_verified": false
  }
}
```

Use `payload.complete_cycles` as the displayed count and retain
`payload.status` and the quality flags. An interrupted set has
`status: "aborted"` and can have only a partial set of quality metrics.
Use the paired session record to resolve the challenge and member. Keep
these results outside any settlement-eligible path.

## Enable delivery on Vultr

After the backend owner supplies the public callback URL and provisions the
event signing key, create `~/.config/moltivate-live/results.env` with mode
`600` and these settings:

- `MOLTIVATE_CALLBACK_URL` is the full HTTPS URL ending in `/api/vision/events`.
- `MOLTIVATE_EVENT_KEY_ID` and `MOLTIVATE_EVENT_SECRET` match the receiver's
  dedicated event credentials. Keep the command signing key separate.
- `MOLTIVATE_STATE_DIR` is an absolute private state directory. Set it to the
  same value in the agent environment. Set `MOLTIVATE_WORKER_RELEASE` in that
  environment to the deployed commit SHA.

From the release checkout, install the user service and timer:

```bash
mkdir -p ~/.config/systemd/user
cp ops/vultr/moltivate-results.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now moltivate-results.timer
journalctl --user -u moltivate-results.service
```

If delivery fails permanently, correct the cause before requeueing the
original row. Preserve its body. For HTTP 409, inspect the receiver's event
ID and sequence history before resuming delivery.
