"""Private, signed session reservation API. A new reservation also opens the
Chert call-binding window, when MOLTIVATE_CHERT_BIN/MOLTIVATE_CHERT_ENV_FILE
are configured on this box -- see ops/vultr/moltivate-control.service's
EnvironmentFile. Still soft: if unconfigured, reservation bookkeeping works
exactly as before and nothing calls out to Chert."""
import asyncio
import hashlib
import hmac
import json
import os
import re
import sqlite3
import time
from pathlib import Path

from aiohttp import web

IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,128}")

_chert_process = None  # the single active window; only one 'reserved' row exists at a time


async def _open_chert_window(minutes):
    global _chert_process
    chert_bin = os.environ.get("MOLTIVATE_CHERT_BIN")
    env_file = os.environ.get("MOLTIVATE_CHERT_ENV_FILE")
    if not chert_bin or not env_file:
        return
    agent = os.environ.get("MOLTIVATE_CHERT_AGENT", "moltivate-transport")
    env = os.environ.copy()
    node_dir = os.environ.get("MOLTIVATE_CHERT_NODE_BIN_DIR")
    if node_dir:
        env["PATH"] = node_dir + os.pathsep + env.get("PATH", "")
    try:
        _chert_process = await asyncio.create_subprocess_exec(
            chert_bin, "dev", "--agent", agent, "--env-file", env_file,
            "--minutes", str(minutes), env=env,
        )
    except OSError:
        _chert_process = None


def _close_chert_window():
    global _chert_process
    if _chert_process is not None and _chert_process.returncode is None:
        _chert_process.terminate()
    _chert_process = None


def database(path):
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires INTEGER);
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
            payload TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL
        );
    """)
    db.execute("UPDATE sessions SET state='aborted' WHERE state='reserved'")
    db.commit()
    return db


def create_app(db, keys):
    @web.middleware
    async def authenticate(request, handler):
        if request.path in ("/healthz", "/readyz"):
            return await handler(request)
        if request.query_string:
            raise web.HTTPBadRequest()
        body = await request.read()
        key = keys.get(request.headers.get("X-Moltivate-Key-Id"))
        stamp = request.headers.get("X-Moltivate-Timestamp", "")
        nonce = request.headers.get("X-Moltivate-Nonce", "")
        signature = request.headers.get("X-Moltivate-Signature", "")
        now = int(time.time())
        if (not key or not stamp.isdigit() or len(stamp) > 12
                or abs(now - int(stamp)) > 60 or not IDENTIFIER.fullmatch(nonce)):
            raise web.HTTPUnauthorized()
        canonical = "\n".join((stamp, nonce, request.method, request.raw_path,
                               hashlib.sha256(body).hexdigest()))
        expected = hmac.new(key.encode(), canonical.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise web.HTTPUnauthorized()
        try:
            with db:
                db.execute("DELETE FROM nonces WHERE expires < ?", (now,))
                db.execute("INSERT INTO nonces VALUES (?, ?)", (nonce, now + 121))
        except sqlite3.IntegrityError:
            raise web.HTTPUnauthorized()
        with db:
            db.execute("UPDATE sessions SET state='expired' WHERE state='reserved' AND expires<=?", (now,))
        return await handler(request)

    app = web.Application(middlewares=[authenticate], client_max_size=8192)

    async def health(request):
        if request.path == "/readyz":
            # Reservation API is usable; caller pairing is not yet deployed.
            return web.json_response({"ready": False, "control_api": True,
                                      "reason": "caller_pairing_pending"}, status=503)
        return web.json_response({"alive": True})

    def representation(row):
        return {"session_id": row[0], "state": row[4], "expires_at": row[5],
                "payout_eligible": False, "transport_ready": False}

    async def start(request):
        raw = await request.read()
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise web.HTTPBadRequest()
        fields = {"session_id", "idempotency_key", "membership_ref", "exercise",
                  "policy_version", "pushup_profile", "prep_seconds", "expires_at"}
        if not isinstance(data, dict) or set(data) - fields:
            raise web.HTTPBadRequest()
        for name in ("session_id", "idempotency_key", "membership_ref"):
            if not isinstance(data.get(name), str) or not IDENTIFIER.fullmatch(data[name]):
                raise web.HTTPBadRequest()
        prep = data.get("prep_seconds", 7)
        expires = data.get("expires_at")
        if (data.get("exercise") != "squats"
                or data.get("policy_version") != "claude-2d-primary-squat-v2"
                or data.get("pushup_profile") is not None
                or type(prep) is not int or not 1 <= prep <= 60
                or type(expires) is not int):
            raise web.HTTPBadRequest()
        digest = hashlib.sha256(raw).hexdigest()
        existing = db.execute("SELECT * FROM sessions WHERE idem=?", (data["idempotency_key"],)).fetchone()
        if existing:
            if existing[2] != digest:
                raise web.HTTPConflict()
            return web.json_response(representation(existing), status=202)
        if not int(time.time()) < expires <= int(time.time()) + 600:
            raise web.HTTPBadRequest()
        if db.execute("SELECT 1 FROM sessions WHERE state='reserved'").fetchone():
            raise web.HTTPConflict(text="Worker capacity reserved")
        try:
            with db:
                db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)",
                           (data["session_id"], data["idempotency_key"], digest,
                            raw.decode(), "reserved", expires))
        except sqlite3.IntegrityError:
            raise web.HTTPConflict()
        row = db.execute("SELECT * FROM sessions WHERE id=?", (data["session_id"],)).fetchone()
        minutes = max(1, (expires - int(time.time()) + 59) // 60)
        await _open_chert_window(minutes)
        return web.json_response(representation(row), status=202)

    async def session(request):
        if request.method == "POST" and await request.read():
            raise web.HTTPBadRequest()
        row = db.execute("SELECT * FROM sessions WHERE id=?", (request.match_info["id"],)).fetchone()
        if row is None:
            raise web.HTTPNotFound()
        if request.method == "POST":
            with db:
                db.execute("UPDATE sessions SET state='ended' WHERE id=? AND state='reserved'", (row[0],))
            row = db.execute("SELECT * FROM sessions WHERE id=?", (row[0],)).fetchone()
            _close_chert_window()
        return web.json_response(representation(row))

    app.router.add_get("/healthz", health)
    app.router.add_get("/readyz", health)
    app.router.add_post("/v1/sessions", start)
    app.router.add_get("/v1/sessions/{id}", session)
    app.router.add_post("/v1/sessions/{id}/end", session)
    return app


if __name__ == "__main__":
    state = Path(os.environ["MOLTIVATE_STATE_DIR"])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    keys = json.loads(os.environ["MOLTIVATE_COMMAND_KEYS"])
    if not keys or any(not isinstance(v, str) or len(v) < 32 for v in keys.values()):
        raise ValueError("Configure command signing keys with at least 32 characters")
    web.run_app(create_app(database(state / "control.sqlite3"), keys),
                host="127.0.0.1", port=8080, access_log=None)
