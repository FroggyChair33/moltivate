-- Enable row level security on every public table, with no policies on
-- purpose: only the app's server touches these tables, and it uses the
-- service-role key, which bypasses RLS. With RLS on and no policies, the
-- anon/publishable key can neither read nor write them through the REST API.
-- Idempotent: safe on a project where this was already enabled by hand.
alter table users enable row level security;
alter table challenges enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table workout_sessions enable row level security;
alter table group_pots enable row level security;
alter table settlements enable row level security;
alter table member_payouts enable row level security;
alter table closed_challenges enable row level security;
