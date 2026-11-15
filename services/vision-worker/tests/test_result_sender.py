import hashlib
import hmac
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from result_sender import deliver_due, enqueue_final, open_outbox


class ResultSenderTests(unittest.TestCase):
    def test_restart_and_retry_preserve_body_and_refresh_signature(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        state_dir = Path(directory)
        db = open_outbox(state_dir)
        result = {"count": 6, "policy": "test", "status": "experimental_only", "payout_eligible": True}
        fields = dict(exercise="squats", termination_reason="set_completed", worker_release="test")
        body = enqueue_final(db, "paired-session", result, **fields)
        self.assertEqual(enqueue_final(db, "paired-session", result, **fields), body)
        with self.assertRaises(ValueError):
            enqueue_final(db, "paired-session", {**result, "count": 7}, **fields)
        db.close()
        event = json.loads(body)
        self.assertFalse(event["payload"]["payout_eligible"])
        db = open_outbox(state_dir)
        self.addCleanup(db.close)
        seen = []

        def receive(request, timeout):
            headers = {key.lower(): value for key, value in request.header_items()}
            nonce = headers["x-moltivate-nonce"]
            self.assertNotIn(nonce, seen)
            seen.append(nonce)
            self.assertEqual(request.data, body)
            canonical = "\n".join((headers["x-moltivate-timestamp"], nonce, "POST",
                                   "/api/vision/events", hashlib.sha256(body).hexdigest()))
            expected = hmac.new(b"event-secret", canonical.encode(), hashlib.sha256).hexdigest()
            self.assertEqual(headers["x-moltivate-signature"], expected)
            if len(seen) == 1:
                raise HTTPError(request.full_url, 503, "unavailable", {}, None)
            response = io.BytesIO(json.dumps({"status": "accepted", "event_id": event["event_id"],
                                              "sequence": event["sequence"]}).encode())
            response.status = 200
            return response

        with patch("result_sender.build_opener") as opener:
            opener.return_value.open.side_effect = receive
            url = "https://backend.example.org/api/vision/events"
            deliver_due(db, url, "event-v1", "event-secret")
            self.assertEqual(db.execute("SELECT state FROM final_events").fetchone()[0], "pending")
            with db:
                db.execute("UPDATE final_events SET next_attempt=0")
            deliver_due(db, url, "event-v1", "event-secret")
            deliver_due(db, url, "event-v1", "event-secret")
        self.assertEqual(len(seen), 2)
        self.assertEqual(db.execute("SELECT state, attempts FROM final_events").fetchone(), ("delivered", 2))
