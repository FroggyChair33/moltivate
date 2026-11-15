"""Durably queue and deliver terminal vision events for explicitly paired sessions."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid

CALLBACK_PATH = "/api/vision/events"
MAX_BODY = 32 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def open_outbox(state_dir):
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(state_dir / "result-outbox.sqlite3")
    db.execute("""
        CREATE TABLE IF NOT EXISTS final_events (
            session_id TEXT PRIMARY KEY, body BLOB NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt INTEGER NOT NULL DEFAULT 0,
            state TEXT NOT NULL DEFAULT 'pending', last_status INTEGER
        )
    """)
    return db


def enqueue_final(db, session_id, result, *, exercise, termination_reason,
                  worker_release, sequence=1):
    """Call with the server-assigned session ID after verified call pairing."""
    if not session_id or type(sequence) is not int or sequence < 1:
        raise ValueError("A paired session ID and positive integer sequence are required")
    payload = {**result, "exercise": exercise, "termination_reason": termination_reason,
               "complete_cycles": result["count"], "payout_eligible": False,
               "form_assessed": False, "identity_verified": False,
               "liveness_verified": False, "exercise_identity_verified": False}
    body = json.dumps({
        "event_id": uuid.uuid4().hex, "session_id": session_id, "sequence": sequence,
        "event_type": "final", "occurred_at": datetime.now(timezone.utc).isoformat(),
        "worker_release": worker_release, "policy_version": result["policy"],
        "payload": payload,
    }, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    if len(body) > MAX_BODY:
        raise ValueError("Final event exceeds 32 KiB")
    with db:
        db.execute("INSERT OR IGNORE INTO final_events(session_id, body) VALUES (?, ?)",
                   (session_id, body))
        stored = db.execute("SELECT body FROM final_events WHERE session_id=?", (session_id,)).fetchone()[0]
        prior = json.loads(stored)
        if prior["payload"] != payload or prior["sequence"] != sequence:
            raise ValueError("Final result already exists with different data")
    return stored


def signed_request(url, key_id, secret, body):
    stamp, nonce = str(int(time.time())), uuid.uuid4().hex
    canonical = "\n".join((stamp, nonce, "POST", CALLBACK_PATH, hashlib.sha256(body).hexdigest()))
    signature = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "X-Moltivate-Key-Id": key_id,
        "X-Moltivate-Timestamp": stamp, "X-Moltivate-Nonce": nonce,
        "X-Moltivate-Signature": signature,
    })


def deliver_due(db, url, key_id, secret):
    target = urlsplit(url)
    if (target.scheme != "https" or not target.hostname or target.username is not None
            or target.path != CALLBACK_PATH or target.query or target.fragment):
        raise ValueError("Configure the fixed HTTPS /api/vision/events callback URL")
    if not key_id or not secret:
        raise ValueError("Configure a dedicated event signing key")
    opener = build_opener(NoRedirect())
    rows = db.execute(
        "SELECT session_id, body, attempts FROM final_events "
        "WHERE state='pending' AND next_attempt<=? ORDER BY next_attempt LIMIT 10",
        (int(time.time()),),
    ).fetchall()
    for session_id, body, attempts in rows:
        status = None
        acknowledged = False
        try:
            with opener.open(signed_request(url, key_id, secret, body), timeout=8) as response:
                status = response.status
                ack = json.loads(response.read(4096))
                event = json.loads(body)
                acknowledged = status == 200 and isinstance(ack, dict) and (
                    ack.get("status"), ack.get("event_id"), ack.get("sequence")
                ) == ("accepted", event["event_id"], event["sequence"])
        except HTTPError as error:
            status = error.code
            error.close()
        except (URLError, OSError, ValueError):
            pass
        permanent = status is not None and 300 <= status < 500 and status not in (408, 429)
        state = "delivered" if acknowledged else "failed" if permanent else "pending"
        delay = min(3600, 15 * 2 ** min(attempts, 8))
        with db:
            db.execute(
                "UPDATE final_events SET state=?, attempts=attempts+1, next_attempt=?, last_status=? "
                "WHERE session_id=? AND state='pending' AND attempts=?",
                (state, int(time.time()) + delay, status, session_id, attempts),
            )
        print(f"Vision callback {state}, HTTP {status}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["drain"])
    parser.parse_args()
    with closing(open_outbox(Path(os.environ["MOLTIVATE_STATE_DIR"]))) as outbox:
        deliver_due(outbox, os.environ["MOLTIVATE_CALLBACK_URL"],
                    os.environ["MOLTIVATE_EVENT_KEY_ID"], os.environ["MOLTIVATE_EVENT_SECRET"])
