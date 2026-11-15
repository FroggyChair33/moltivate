-- UI-only dismissal list. Hides a challenge from the "Your challenges"
-- nav link and from being offered as a rematch target. Never affects
-- on-chain claim ability in any way -- claim() always works regardless of
-- this table's contents. A row may only be inserted once a challenge is
-- actually settled AND every member has actually claimed (enforced in
-- app/api/challenges/close, not by any constraint here, since that check
-- requires reading real on-chain state).

create table closed_challenges (
    challenge_pubkey text primary key check (char_length(challenge_pubkey) between 32 and 44),
    closed_by text not null check (char_length(closed_by) between 32 and 44),
    closed_at timestamptz not null default now()
);

comment on column closed_challenges.closed_by is
    'Wallet that closed it -- must be the creator or a joined member, checked server-side against on-chain state.';
