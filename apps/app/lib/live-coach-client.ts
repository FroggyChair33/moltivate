// Server-only client for the Vultr live-coach control API (teammate's
// branch: codex/live-coach-transport, services/vision-worker/control_api.py).
// Signing scheme extracted directly from that real server's source and
// verified against a locally-run copy of it, not guessed from the prose
// handoff doc: canonical = timestamp + "\n" + nonce + "\n" + METHOD + "\n"
// + raw_path + "\n" + hex(sha256(body)); signature = hex(HMAC-SHA256(secret,
// canonical)). The server rejects any request with a query string, requires
// an empty body for GET and for the /end POST, and allows at most 60s of
// clock skew.
//
// This never reaches the browser -- the signing secret must never be
// client-exposed (same reasoning as ORACLE_SECRET_KEY/WORKOUT_INGEST_SECRET).
import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";

export class LiveCoachNotConfiguredError extends Error {}

function env(): { baseUrl: string; keyId: string; secret: string } {
  const baseUrl = process.env.LIVE_COACH_BASE_URL;
  const keyId = process.env.LIVE_COACH_KEY_ID;
  const secret = process.env.LIVE_COACH_SECRET;
  if (!baseUrl || !keyId || !secret) {
    // Expected until the worker has a real public hostname and the
    // teammate has provisioned a signing key into this app's server-only
    // env -- see docs/live/APP_HANDOFF.md. Not a bug.
    throw new LiveCoachNotConfiguredError(
      "LIVE_COACH_BASE_URL / LIVE_COACH_KEY_ID / LIVE_COACH_SECRET are not all set",
    );
  }
  return { baseUrl, keyId, secret };
}

function sign(keyId: string, secret: string, method: string, path: string, body: Buffer) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  const canonical = [timestamp, nonce, method, path, bodyDigest].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return {
    "X-Moltivate-Key-Id": keyId,
    "X-Moltivate-Timestamp": timestamp,
    "X-Moltivate-Nonce": nonce,
    "X-Moltivate-Signature": signature,
  };
}

async function call(method: "GET" | "POST", path: string, body?: object) {
  const { baseUrl, keyId, secret } = env();
  const bodyBytes = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  const headers = sign(keyId, secret, method, path, bodyBytes);
  const res = await fetch(baseUrl + path, {
    method,
    headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
    body: body ? bodyBytes : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export type LiveCoachSession = {
  session_id: string;
  state: string;
  expires_at: number;
  payout_eligible: false;
  transport_ready: boolean;
};

// Only "squats" / "claude-2d-primary-squat-v2" are accepted by the real
// server right now -- confirmed in its source, not just the docs.
export async function startLiveCoachSession(args: {
  sessionId: string;
  idempotencyKey: string;
  membershipRef: string;
  expiresInSeconds: number;
  prepSeconds?: number;
}) {
  return call("POST", "/v1/sessions", {
    session_id: args.sessionId,
    idempotency_key: args.idempotencyKey,
    membership_ref: args.membershipRef,
    exercise: "squats",
    policy_version: "claude-2d-primary-squat-v2",
    expires_at: Math.floor(Date.now() / 1000) + args.expiresInSeconds,
    ...(args.prepSeconds ? { prep_seconds: args.prepSeconds } : {}),
  });
}

export async function getLiveCoachSession(sessionId: string) {
  return call("GET", `/v1/sessions/${sessionId}`);
}

export async function endLiveCoachSession(sessionId: string) {
  return call("POST", `/v1/sessions/${sessionId}/end`);
}
