import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { verifyMoltivateSignature } from "@/lib/moltivate-signature";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// Receives signed progress/final events from the Vultr live-coach worker
// (docs/live/ENDPOINT_CONTRACT.md's "VM -> Vercel" direction). The reverse
// of lib/live-coach-client.ts: that one signs outbound requests to the
// worker with LIVE_COACH_* creds; this one verifies inbound requests from
// it with a *separate* event key, per the contract's "separate command/
// event secrets" -- a compromised command key (which can only
// reserve/check/end a session) shouldn't also be able to forge results.
//
// Deliberately does NOT yet write into workout_sessions. The final
// event's exact field names (counts, rejection reasons, etc.) beyond the
// trust-flags block aren't pinned down in the contract doc -- see
// docs/live/APP_HANDOFF.md. Guessing field names and writing speculative
// data into a real table is worse than not writing at all; the full raw
// payload is persisted here untouched so nothing is lost once that's
// agreed, and extending this to also insert a (still trust_level
// 'unverified') workout_sessions row is a small follow-up once it is.
const MAX_BODY_BYTES = 32 * 1024;
const PATH = "/api/vision/events";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

export async function POST(request: Request) {
  const keyId = process.env.LIVE_COACH_EVENT_KEY_ID;
  const secret = process.env.LIVE_COACH_EVENT_SECRET;
  if (!keyId || !secret) {
    return NextResponse.json({ error: "vision events receiver is not configured yet" }, { status: 503 });
  }

  try {
    const rawBody = Buffer.from(await request.arrayBuffer());
    if (rawBody.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "body too large" }, { status: 413 });
    }

    const givenKeyId = request.headers.get("X-Moltivate-Key-Id");
    if (givenKeyId !== keyId) {
      return NextResponse.json({ error: "unknown key id" }, { status: 401 });
    }

    const check = verifyMoltivateSignature({
      method: "POST",
      path: PATH,
      rawBody,
      secret,
      headers: {
        keyId: givenKeyId,
        timestamp: request.headers.get("X-Moltivate-Timestamp"),
        nonce: request.headers.get("X-Moltivate-Nonce"),
        signature: request.headers.get("X-Moltivate-Signature"),
      },
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 401 });
    }

    const supabase = getSupabaseServerClient();

    // Replay protection: a nonce used twice is rejected outright, same as
    // the worker's own middleware does for requests signed by us.
    await supabase.from("vision_event_nonces").delete().lt("expires_at", new Date().toISOString());
    const { error: nonceError } = await supabase
      .from("vision_event_nonces")
      .insert({ nonce: check.nonce, expires_at: new Date(Date.now() + 120_000).toISOString() });
    if (nonceError) {
      // Unique violation -- this exact nonce was already used.
      return NextResponse.json({ error: "replayed nonce" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !IDENTIFIER.test((body as Record<string, unknown>).event_id as string) ||
      !IDENTIFIER.test((body as Record<string, unknown>).session_id as string) ||
      typeof (body as Record<string, unknown>).sequence !== "number" ||
      !Number.isInteger((body as Record<string, unknown>).sequence) ||
      ((body as Record<string, unknown>).sequence as number) < 0 ||
      typeof (body as Record<string, unknown>).event_type !== "string" ||
      typeof (body as Record<string, unknown>).occurred_at !== "string" ||
      !("payload" in body)
    ) {
      return NextResponse.json(
        { error: "event_id, session_id, sequence (int >= 0), event_type, occurred_at, payload required" },
        { status: 400 },
      );
    }
    const event = body as {
      event_id: string;
      session_id: string;
      sequence: number;
      event_type: string;
      occurred_at: string;
      payload: unknown;
    };

    const bodyDigest = createHash("sha256").update(rawBody).digest("hex");

    // Idempotency: a retried event_id with the same body returns the same
    // result; a different body for the same event_id is a real conflict.
    const { data: existing, error: existingError } = await supabase
      .from("vision_events")
      .select("event_id, body_digest, sequence")
      .eq("event_id", event.event_id)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (existing) {
      if (existing.body_digest !== bodyDigest) {
        return NextResponse.json({ error: "event_id already used with a different body" }, { status: 409 });
      }
      return NextResponse.json({ status: "accepted", event_id: existing.event_id, sequence: existing.sequence });
    }

    // Per-session ordering: reject anything at or behind the highest
    // sequence already recorded for this session_id.
    const { data: latest, error: latestError } = await supabase
      .from("vision_events")
      .select("sequence")
      .eq("session_id", event.session_id)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) {
      return NextResponse.json({ error: latestError.message }, { status: 500 });
    }
    if (latest && event.sequence <= latest.sequence) {
      return NextResponse.json(
        { error: `sequence ${event.sequence} is not after the last recorded sequence ${latest.sequence}` },
        { status: 409 },
      );
    }

    const { error: insertError } = await supabase.from("vision_events").insert({
      event_id: event.event_id,
      session_id: event.session_id,
      sequence: event.sequence,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      body_digest: bodyDigest,
      payload: event.payload,
    });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ status: "accepted", event_id: event.event_id, sequence: event.sequence });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
