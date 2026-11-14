-- Commitment Stakes schema: challenges, teams, workout sessions, and settlement records.
--
-- Everything here is an off-chain convenience index. The Anchor program
-- (programs/commitment-stakes/, owned separately) is the sole authority for
-- fund movement; rows here (including settlements/payouts) describe what the
-- chain did or is expected to do, never the other way around. See AGENTS.md
-- "Financial correctness" and "Verification, authentication, and data".
--
-- All lamport amounts are bigint. Never use floating point for money here or
-- in application code reading/writing these columns.

create extension if not exists pgcrypto;

create table users (
    id uuid primary key default gen_random_uuid(),
    wallet_address text not null unique check (char_length(wallet_address) between 32 and 44),
    display_name text check (char_length(display_name) between 1 and 80),
    created_at timestamptz not null default now()
);

comment on column users.wallet_address is
    'Base58 Solana pubkey. A supplied address alone is not authentication -- see AGENTS.md.';

create table challenges (
    id uuid primary key default gen_random_uuid(),
    creator_id uuid not null references users(id),
    title text not null check (char_length(title) between 1 and 120),
    exercise text not null check (char_length(exercise) between 1 and 40),
    stake_lamports bigint not null check (stake_lamports > 0),
    target_reps integer not null check (target_reps > 0),
    alpha_bps integer not null check (alpha_bps between 0 and 10000),
    rake_bps integer not null default 300 check (rake_bps between 0 and 10000),
    rules_version integer not null default 1 check (rules_version > 0),
    starts_at timestamptz,
    ends_at timestamptz not null,
    status text not null default 'draft'
        check (status in ('draft', 'open', 'active', 'settled', 'cancelled')),
    created_at timestamptz not null default now(),
    check (starts_at is null or ends_at > starts_at)
);

comment on column challenges.stake_lamports is
    'Per-member stake S. No deposit has happened until the Anchor program confirms it on-chain.';
comment on column challenges.alpha_bps is
    'Alpha in basis points (e.g. 2000 = 20%), used in the forfeit formula S * (alpha + (1-alpha) * shortfall_ratio).';
comment on column challenges.rake_bps is
    'House rake in basis points, taken from forfeits only, waived (0 applied) when both teams pass.';
comment on column challenges.rules_version is
    'Bumped whenever settlement/forfeit rules change. An already-open challenge keeps the rules_version it was created with.';
comment on column challenges.status is
    'Off-chain draft lifecycle only. Not a mirror of the on-chain challenge state machine.';

create table teams (
    id uuid primary key default gen_random_uuid(),
    challenge_id uuid not null references challenges(id) on delete cascade,
    name text not null check (char_length(name) between 1 and 60),
    created_at timestamptz not null default now(),
    unique (challenge_id, name)
);

-- Exactly two teams per challenge.
create function enforce_two_teams_per_challenge() returns trigger as $$
begin
    if (select count(*) from teams where challenge_id = new.challenge_id) >= 2 then
        raise exception 'challenge % already has two teams', new.challenge_id;
    end if;
    return new;
end;
$$ language plpgsql;

create trigger teams_max_two_per_challenge
    before insert on teams
    for each row execute function enforce_two_teams_per_challenge();

create table team_members (
    id uuid primary key default gen_random_uuid(),
    team_id uuid not null references teams(id) on delete cascade,
    -- Denormalized from teams.challenge_id (kept in sync by the trigger below)
    -- so "one team per challenge per user" is a plain unique constraint.
    challenge_id uuid not null references challenges(id) on delete cascade,
    user_id uuid not null references users(id),
    stake_lamports bigint not null default 0 check (stake_lamports >= 0),
    deposit_tx_signature text,
    deposited_at timestamptz,
    joined_at timestamptz not null default now(),
    unique (team_id, user_id),
    unique (challenge_id, user_id)
);

comment on column team_members.stake_lamports is
    'Set once deposit_tx_signature is confirmed on-chain, not on join alone.';

create function set_team_member_challenge_id() returns trigger as $$
begin
    select challenge_id into new.challenge_id from teams where id = new.team_id;
    return new;
end;
$$ language plpgsql;

create trigger team_members_set_challenge_id
    before insert or update of team_id on team_members
    for each row execute function set_team_member_challenge_id();

create table workout_sessions (
    id uuid primary key default gen_random_uuid(),
    team_member_id uuid not null references team_members(id) on delete cascade,
    source text not null check (source in ('chert_facetime', 'browser_mediapipe')),
    reps integer not null check (reps >= 0),
    trust_level text not null check (trust_level in ('verified', 'low_trust', 'unverified')),
    liveness_result text not null default 'not_run'
        check (liveness_result in ('not_run', 'pass', 'fail')),
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'rejected')),
    idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
    rejection_reason text,
    created_at timestamptz not null default now(),
    unique (team_member_id, idempotency_key)
);

comment on column workout_sessions.trust_level is
    'Server-derived from source and verifier output, never client-supplied.';
comment on column workout_sessions.reps is
    'Raw reported/measured count. Settlement must still cap counted contribution at 150% of the individual goal.';

create index workout_sessions_team_member_id_idx on workout_sessions(team_member_id);

-- A persistent pot that collects forfeits when both teams in a challenge
-- fail their goal. One row per owning group; the MVP uses a single
-- 'default' pot. Balance changes only through settlements
-- (group_pot_delta_lamports below), applied by the oracle/settlement job,
-- never by direct client writes.
create table group_pots (
    id uuid primary key default gen_random_uuid(),
    label text not null unique check (char_length(label) between 1 and 60),
    balance_lamports bigint not null default 0 check (balance_lamports >= 0),
    updated_at timestamptz not null default now()
);

insert into group_pots (label) values ('default');

create table settlements (
    id uuid primary key default gen_random_uuid(),
    challenge_id uuid not null unique references challenges(id),
    rules_version integer not null check (rules_version > 0),
    winning_team_id uuid references teams(id),
    both_teams_failed boolean not null default false,
    house_rake_bps_applied integer not null check (house_rake_bps_applied between 0 and 10000),
    house_rake_lamports bigint not null default 0 check (house_rake_lamports >= 0),
    group_pot_id uuid references group_pots(id),
    group_pot_delta_lamports bigint not null default 0,
    settlement_tx_signature text,
    status text not null default 'pending'
        check (status in ('pending', 'confirmed', 'failed')),
    settled_at timestamptz,
    created_at timestamptz not null default now(),
    check (winning_team_id is null or both_teams_failed = false)
);

comment on column settlements.rules_version is
    'Copied from challenges.rules_version at settlement time, so a later rule change never reinterprets a past settlement.';
comment on column settlements.house_rake_lamports is
    'Taken from forfeits only, never from winners'' principal. 0 when both teams passed (rake waived).';
comment on column settlements.group_pot_delta_lamports is
    'Signed lamport change applied to group_pots.balance_lamports by this settlement (positive when both teams fail and forfeits land in the pot).';
comment on column settlements.settlement_tx_signature is
    'The on-chain settle() transaction signature this row reports on. The signature/chain state is authoritative, this row is a cache.';

create table member_payouts (
    id uuid primary key default gen_random_uuid(),
    settlement_id uuid not null references settlements(id) on delete cascade,
    team_member_id uuid not null references team_members(id),
    outcome text not null check (outcome in ('won', 'forfeited', 'refunded')),
    forfeit_lamports bigint not null default 0 check (forfeit_lamports >= 0),
    payout_lamports bigint not null default 0 check (payout_lamports >= 0),
    counted_reps integer not null default 0 check (counted_reps >= 0),
    claim_tx_signature text,
    claimed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (settlement_id, team_member_id)
);

comment on column member_payouts.forfeit_lamports is
    'S * (alpha + (1-alpha) * shortfall_ratio), capped at the member''s stake. 0 for a winning/refunded member.';
comment on column member_payouts.counted_reps is
    'Reps credited toward this member''s goal after the 150%-of-goal cap, i.e. the shortfall_ratio input.';

create index member_payouts_team_member_id_idx on member_payouts(team_member_id);
