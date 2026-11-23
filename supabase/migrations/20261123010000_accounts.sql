-- Accounts and wallet linking: email/password accounts (Supabase Auth) with a
-- display name, and wallets linked to an account by a signed, single-use nonce.
-- Like the rest of the schema this is an index, never the authority on funds.
--
-- NOT YET APPLIED: this file has not been executed against any database.
--
-- RLS is on with no policies, as in 20261120010000_enable_rls.sql: only the
-- app's server touches these tables, using the service-role key.

-- The old wallet-keyed `users` table stays: challenges.creator_id and
-- team_members.user_id reference it. The app no longer reads or writes it once
-- accounts ship.
comment on table users is
    'Legacy wallet-keyed table. Kept only because challenges.creator_id and team_members.user_id reference it; the app no longer reads or writes it.';

create table profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null check (char_length(display_name) between 1 and 40),
    display_name_key text not null unique,
    created_at timestamptz not null default now()
);

comment on column profiles.display_name_key is
    'Normalised display name used for case-insensitive uniqueness.';

create table linked_wallets (
    wallet_address text primary key check (char_length(wallet_address) between 32 and 44),
    user_id uuid not null references auth.users(id) on delete cascade,
    linked_at timestamptz not null default now()
);

create index linked_wallets_user_id_idx on linked_wallets (user_id);

create table wallet_link_nonces (
    nonce text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    wallet_address text not null,
    purpose text not null check (purpose in ('link', 'unlink')),
    expires_at timestamptz not null,
    used_at timestamptz
);

alter table profiles enable row level security;
alter table linked_wallets enable row level security;
alter table wallet_link_nonces enable row level security;

-- Which account a workout session was submitted under (null for older rows).
alter table workout_sessions add column account_id uuid references auth.users(id) on delete set null;

-- Atomically consume a 'link' nonce and link the wallet. Returns
-- 'linked', 'bad_nonce' or 'taken' (wallet already linked; nonce left unused).
create or replace function link_wallet(p_nonce text, p_user uuid, p_wallet text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_nonce wallet_link_nonces%rowtype;
begin
    select * into v_nonce from wallet_link_nonces where nonce = p_nonce for update;
    if not found
        or v_nonce.purpose <> 'link'
        or v_nonce.user_id <> p_user
        or v_nonce.wallet_address <> p_wallet
        or v_nonce.used_at is not null
        or v_nonce.expires_at <= now() then
        return 'bad_nonce';
    end if;

    begin
        insert into linked_wallets (wallet_address, user_id) values (p_wallet, p_user);
    exception when unique_violation then
        return 'taken';
    end;

    update wallet_link_nonces set used_at = now() where nonce = p_nonce;
    return 'linked';
end;
$$;

-- Functions in `public` are callable through the anon key's RPC endpoint unless revoked.
revoke all on function link_wallet(text, uuid, text) from public, anon, authenticated;
grant execute on function link_wallet(text, uuid, text) to service_role;
