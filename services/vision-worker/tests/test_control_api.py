"""Signed control requests against an isolated HTTP server and SQLite database."""
import hashlib
import hmac
import json
import tempfile
import time
import unittest
import uuid
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer
from control_api import create_app, database


class ControlTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = database(Path(self.directory.name) / "test.db")
        self.key = "test-only-secret" * 3
        self.client = TestClient(TestServer(create_app(self.db, {"test": self.key})))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.db.close()
        self.directory.cleanup()

    def headers(self, method, path, body=b"", timestamp=None, nonce=None):
        stamp = str(timestamp or int(time.time()))
        nonce = nonce or uuid.uuid4().hex
        canonical = "\n".join((stamp, nonce, method, path, hashlib.sha256(body).hexdigest()))
        return {"X-Moltivate-Key-Id": "test", "X-Moltivate-Timestamp": stamp,
                "X-Moltivate-Nonce": nonce,
                "X-Moltivate-Signature": hmac.new(self.key.encode(), canonical.encode(), hashlib.sha256).hexdigest()}

    async def request(self, method, path, body=b"", headers=None):
        return await self.client.request(method, path, data=body,
                                         headers=headers or self.headers(method, path, body))

    async def test_authentication_and_replay(self):
        path = "/v1/sessions/unknown"
        headers = self.headers("GET", path)
        self.assertEqual((await self.request("GET", path, headers=headers)).status, 404)
        self.assertEqual((await self.request("GET", path, headers=headers)).status, 401)
        old = self.headers("GET", path, timestamp=int(time.time()) - 61)
        self.assertEqual((await self.request("GET", path, headers=old)).status, 401)
        self.assertEqual((await self.request("POST", "/v1/sessions", b"changed",
                         self.headers("POST", "/v1/sessions", b"original"))).status, 401)
        self.assertEqual((await self.client.get(path)).status, 401)

    async def test_capacity_idempotency_stop_and_restart(self):
        payload = {"session_id": "one", "idempotency_key": "one", "membership_ref": "member",
                   "exercise": "squats", "policy_version": "claude-2d-primary-squat-v2",
                   "expires_at": int(time.time()) + 90}
        body = json.dumps(payload).encode()
        for _ in range(2):
            self.assertEqual((await self.request("POST", "/v1/sessions", body)).status, 202)
        payload["prep_seconds"] = 8
        self.assertEqual((await self.request("POST", "/v1/sessions", json.dumps(payload).encode())).status, 409)
        payload.update(session_id="two", idempotency_key="two")
        self.assertEqual((await self.request("POST", "/v1/sessions", json.dumps(payload).encode())).status, 409)
        for _ in range(2):
            response = await self.request("POST", "/v1/sessions/one/end")
            self.assertEqual((await response.json())["state"], "ended")
        self.assertEqual((await self.request("POST", "/v1/sessions", json.dumps(payload).encode())).status, 202)
        restarted = database(Path(self.directory.name) / "test.db")
        self.assertEqual(restarted.execute("SELECT state FROM sessions WHERE id='two'").fetchone()[0], "aborted")
        restarted.close()
