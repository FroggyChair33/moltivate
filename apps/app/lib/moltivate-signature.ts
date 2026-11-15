// Verifies an inbound request signed the same way lib/live-coach-client.ts
// signs outbound ones -- same scheme as the VM's own control_api.py
// middleware, just checked instead of produced. Used by
// app/api/vision/events, which receives signed calls *from* the worker
// (the reverse direction of the command API).
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 60;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type SignatureCheck =
  | { ok: true; nonce: string }
  | { ok: false; reason: string };

export function verifyMoltivateSignature(args: {
  method: string;
  path: string;
  rawBody: Buffer;
  secret: string;
  headers: { keyId: string | null; timestamp: string | null; nonce: string | null; signature: string | null };
}): SignatureCheck {
  const { timestamp, nonce, signature } = args.headers;
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: "missing or malformed timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp outside allowed clock skew" };
  }
  if (!nonce || !NONCE_PATTERN.test(nonce)) {
    return { ok: false, reason: "missing or malformed nonce" };
  }
  if (!signature) {
    return { ok: false, reason: "missing signature" };
  }

  const bodyDigest = createHash("sha256").update(args.rawBody).digest("hex");
  const canonical = [timestamp, nonce, args.method, args.path, bodyDigest].join("\n");
  const expected = createHmac("sha256", args.secret).update(canonical).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true, nonce };
}
