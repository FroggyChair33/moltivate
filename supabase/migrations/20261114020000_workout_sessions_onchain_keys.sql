-- Re-keys workout_sessions to the on-chain challenge/team_member pubkeys
-- directly, instead of local team_members.id.
--
-- Why: the create/join flows (programs/commitment-stakes/ + apps/app) call
-- the Anchor program directly and never populate users/teams/team_members --
-- the chain is already the authoritative roster (every Challenge/Team/
-- TeamMember account is fully queryable via getProgramAccounts), so
-- mirroring it into a parallel off-chain table before workout sessions can
-- reference anything would just be duplicate bookkeeping with a sync-drift
-- risk, for no benefit. workout_sessions is the one piece of evidence that
-- genuinely has no on-chain equivalent (video/CV verification results), so
-- it's the only table that needs to exist right now; it just needs to key
-- off the real on-chain identity instead of a never-populated local one.
-- users/teams/team_members/settlements/member_payouts stay defined for
-- later off-chain indexing (e.g. a dashboard querying by wallet across
-- challenges) but aren't required for the oracle to function.

alter table workout_sessions drop constraint workout_sessions_team_member_id_fkey;
drop index if exists workout_sessions_team_member_id_idx;
alter table workout_sessions drop column team_member_id;

alter table workout_sessions
    add column challenge_pubkey text not null check (char_length(challenge_pubkey) between 32 and 44),
    add column team_member_pubkey text not null check (char_length(team_member_pubkey) between 32 and 44);

comment on column workout_sessions.challenge_pubkey is
    'Base58 address of the on-chain Challenge account.';
comment on column workout_sessions.team_member_pubkey is
    'Base58 address of the on-chain TeamMember account (not the owner wallet) -- see lib.rs seeds [b"member", challenge, owner].';

alter table workout_sessions add constraint workout_sessions_member_idempotency_key
    unique (team_member_pubkey, idempotency_key);

create index workout_sessions_team_member_pubkey_idx on workout_sessions(team_member_pubkey);
create index workout_sessions_challenge_pubkey_idx on workout_sessions(challenge_pubkey);
