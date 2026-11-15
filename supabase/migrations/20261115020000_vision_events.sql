-- Receiver-side state for the VM -> Vercel results callback
-- (POST /api/vision/events, docs/live/ENDPOINT_CONTRACT.md). Mirrors the
-- VM's own nonces/sessions tables (services/vision-worker/control_api.py)
-- but for the opposite direction: verifying signed requests *from* the
-- worker instead of signing requests *to* it.

create table vision_event_nonces (
    nonce text primary key check (char_length(nonce) between 1 and 128),
    expires_at timestamptz not null
);

comment on table vision_event_nonces is
    'Replay protection for inbound signed events. A nonce seen twice is a replay -> reject.';

create table vision_events (
    event_id text primary key check (char_length(event_id) between 1 and 128),
    session_id text not null check (char_length(session_id) between 1 and 128),
    sequence bigint not null check (sequence >= 0),
    event_type text not null check (char_length(event_type) between 1 and 64),
    occurred_at timestamptz not null,
    -- sha256 of the exact raw request body that produced this row, so a
    -- retried event_id with a *different* body can be told apart from a
    -- legitimate retry of the same one (contract: same key/same body ->
    -- existing result; same key/different body -> 409).
    body_digest text not null,
    -- Full event payload, stored as-is. The final-event payload's exact
    -- field names (beyond the trust-flags block) aren't pinned down yet --
    -- see docs/live/APP_HANDOFF.md -- so nothing here tries to parse
    -- specific fields out of it into other columns. Once that's agreed,
    -- a terminal event can additionally write a real workout_sessions row.
    payload jsonb not null,
    received_at timestamptz not null default now()
);

comment on table vision_events is
    'Every accepted event from the worker, verbatim. Dedup key is event_id; sequence is enforced per session_id at insert time, not by a constraint here (needs a read-then-check, done in app/api/vision/events).';

create index vision_events_session_id_idx on vision_events(session_id, sequence);
