import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Guard test: reads the migration as text. It does NOT execute the SQL.
const sql = fs.readFileSync(new URL("../../../supabase/migrations/20261123010000_accounts.sql", import.meta.url), "utf8");
const lower = sql.toLowerCase();

test("every new table has row level security enabled", () => {
  for (const table of ["profiles", "linked_wallets", "wallet_link_nonces"]) {
    assert.match(lower, new RegExp(`create table ${table} [(]`), `${table} created`);
    assert.match(lower, new RegExp(`alter table ${table} enable row level security`), `${table} RLS`);
  }
});

test("no policies are created", () => {
  assert.doesNotMatch(lower, /create policy/);
});

test("wallet_address is the linked_wallets primary key and display_name_key is unique", () => {
  assert.match(lower, /wallet_address text primary key/);
  assert.match(lower, /display_name_key text not null unique/);
});

test("link_wallet is security definer, pinned search_path with pg_temp, service_role only", () => {
  const start = lower.indexOf("create or replace function link_wallet(");
  assert.ok(start >= 0, "link_wallet defined");
  const next = lower.indexOf("create or replace function", start + 1);
  const body = lower.slice(start, next < 0 ? undefined : next);
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = public, pg_temp/);
  assert.match(body, /for update/);
  // revoke/grant sit after the function body, so check the whole file.
  assert.ok(lower.includes("revoke all on function link_wallet(text, uuid, text) from public, anon, authenticated;"));
  assert.ok(lower.includes("grant execute on function link_wallet(text, uuid, text) to service_role;"));
});

test("the unused unlink_wallet function is not defined", () => {
  // The unlink route claims the nonce and deletes the link itself.
  assert.doesNotMatch(lower, /function unlink_wallet/);
});

test("workout_sessions gains account_id that is nulled when the user is deleted", () => {
  assert.match(lower, /alter table workout_sessions add column account_id uuid references auth\.users\(id\) on delete set null/);
});
