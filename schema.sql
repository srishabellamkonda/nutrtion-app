-- ============================================================
-- NutriSync — schema additions
-- Safe to run more than once (uses "if not exists" / "or replace"
-- everywhere it can). Run this in the Supabase SQL Editor.
-- ============================================================

-- ---------- profiles: new columns ----------
alter table profiles add column if not exists email text;
alter table profiles add column if not exists role text default 'user';
alter table profiles add column if not exists current_streak int default 0;
alter table profiles add column if not exists height_unit text default 'imperial';
alter table profiles add column if not exists weight_unit text default 'lbs';
alter table profiles add column if not exists last_login timestamptz;

-- Make sure role can only ever be 'user' or 'admin'
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table profiles add constraint profiles_role_check check (role in ('user','admin'));
  end if;
end $$;

-- ---------- auto-create a profile row when someone signs up ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- helper: is the current user an admin? ----------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- profiles RLS ----------
alter table profiles enable row level security;

drop policy if exists "profiles_select_own_or_admin" on profiles;
create policy "profiles_select_own_or_admin" on profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Lets a signed-in user create their OWN profile row if one doesn't already
-- exist yet (self-heals onboarding even if the new-user trigger above was
-- added after some accounts already existed, or ran into a timing issue).
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid());

-- Lets the login screen tell "wrong password" apart from "no such account",
-- without exposing anything beyond whether an email is registered.
create or replace function public.email_exists(check_email text)
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from profiles where lower(email) = lower(check_email));
$$;
grant execute on function public.email_exists to anon, authenticated;

-- ---------- food_logs (each day's logged food, per user) ----------
create table if not exists food_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  log_date date not null default current_date,
  name text not null,
  calories numeric not null default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  created_at timestamptz default now()
);
create index if not exists food_logs_user_date_idx on food_logs (user_id, log_date);

alter table food_logs enable row level security;
drop policy if exists "food_logs_owner_all" on food_logs;
create policy "food_logs_owner_all" on food_logs
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- ---------- activity_logs (manually-logged exercise calories burned) ----------
create table if not exists activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  log_date date not null default current_date,
  name text default 'Activity',
  calories_burned numeric not null default 0,
  discount boolean not null default false, -- true = add these back to today's calorie goal
  created_at timestamptz default now()
);
create index if not exists activity_logs_user_date_idx on activity_logs (user_id, log_date);

alter table activity_logs enable row level security;
drop policy if exists "activity_logs_owner_all" on activity_logs;
create policy "activity_logs_owner_all" on activity_logs
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- ---------- saved_meals ----------
create table if not exists saved_meals (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  calories numeric not null default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0
);

alter table saved_meals enable row level security;
drop policy if exists "saved_meals_owner_all" on saved_meals;
create policy "saved_meals_owner_all" on saved_meals
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- ---------- migrate away from the old shared-group model ----------
drop function if exists public.add_accountability_partner(text);
drop function if exists public.get_my_group();
drop function if exists public.set_link_streaks(boolean);
drop function if exists public.get_my_pending_invites();
drop function if exists public.respond_to_partner_request(bigint, boolean);
drop function if exists public.remove_accountability_partner(uuid);
drop table if exists public.group_members cascade;
drop table if exists public.accountability_groups cascade;

-- ---------- partnerships (individual, pairwise — NOT shared groups) ----------
-- Each row is ONE relationship between two specific people. Nick adding
-- Sarah and Nick adding Amy are two totally separate rows — Sarah and Amy
-- are not connected to each other just because they're both linked to Nick.
-- Each person can have up to 4 accepted partnerships, each independent.
create table if not exists partnerships (
  id bigint generated always as identity primary key,
  requester_id uuid references auth.users(id) on delete cascade not null,
  recipient_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending','accepted')),
  link_streaks boolean not null default true,
  created_at timestamptz default now(),
  constraint no_self_partner check (requester_id <> recipient_id)
);
create unique index if not exists partnerships_unique_pair
  on partnerships (least(requester_id, recipient_id), greatest(requester_id, recipient_id));

alter table partnerships enable row level security;
drop policy if exists "partnerships_select" on partnerships;
create policy "partnerships_select" on partnerships
  for select using (requester_id = auth.uid() or recipient_id = auth.uid() or public.is_admin());

-- ---------- login_events (for admin usage stats) ----------
create table if not exists login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  logged_at timestamptz default now()
);
alter table login_events enable row level security;
drop policy if exists "login_events_insert_own" on login_events;
create policy "login_events_insert_own" on login_events
  for insert with check (user_id = auth.uid());

-- ---------- foods (shared reference database, read-only to users) ----------
create table if not exists foods (
  id bigint generated always as identity primary key,
  name text not null,
  calories numeric not null,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  category text default 'general'   -- 'high_protein' | 'low_calorie' | 'general'
);
alter table foods enable row level security;
drop policy if exists "foods_public_read" on foods;
create policy "foods_public_read" on foods
  for select using (true);

-- ============================================================
-- FUNCTIONS the app calls (these bypass RLS safely, on purpose,
-- so one user can act on a shared group / see the leaderboard
-- without being able to read other people's private data)
-- ============================================================

-- Was a given user on-goal for a given day? Returns null if they logged
-- nothing that day at all (treated as "not on goal" by callers).
create or replace function public.is_day_on_goal(p_user_id uuid, p_date date)
returns boolean
language plpgsql
security definer
stable
as $$
declare
  goal numeric;
  gtype text;
  total numeric;
  buffer int := 50;
begin
  select calorie_goal, goal_type into goal, gtype from profiles where id = p_user_id;
  if goal is null then goal := 2000; end if;
  if gtype is null then gtype := 'maintain'; end if;

  select coalesce(sum(calories),0) into total from food_logs where user_id = p_user_id and log_date = p_date;
  if total = 0 then return null; end if;

  if gtype = 'lose' then
    return total <= goal + buffer;
  elsif gtype in ('gain','muscle') then
    return total >= goal - buffer;
  else
    return abs(total - goal) <= buffer;
  end if;
end;
$$;
grant execute on function public.is_day_on_goal to authenticated;

-- Recalculate + store the caller's own streak. If the caller has any
-- accepted partnership with link_streaks turned on, that specific
-- partner ALSO has to have hit their own goal that day, or the streak
-- breaks — but only because of THAT partner, never anyone else's.
create or replace function public.recompute_my_streak()
returns int
language plpgsql
security definer
as $$
declare
  d date := current_date;
  streak int := 0;
  my_ok boolean;
  partner_ok boolean;
  all_ok boolean;
  partner_ids uuid[];
  pid uuid;
begin
  select array_agg(case when requester_id = auth.uid() then recipient_id else requester_id end)
    into partner_ids
  from partnerships
  where status = 'accepted' and link_streaks = true
    and (requester_id = auth.uid() or recipient_id = auth.uid());

  loop
    my_ok := public.is_day_on_goal(auth.uid(), d);
    exit when my_ok is null;
    all_ok := my_ok;

    if all_ok and partner_ids is not null then
      foreach pid in array partner_ids loop
        partner_ok := public.is_day_on_goal(pid, d);
        if partner_ok is not true then
          all_ok := false;
          exit;
        end if;
      end loop;
    end if;

    exit when not all_ok;
    streak := streak + 1;
    d := d - 1;
  end loop;

  update profiles set current_streak = streak where id = auth.uid();
  return streak;
end;
$$;
grant execute on function public.recompute_my_streak to authenticated;

-- Global top-N leaderboard (only exposes name + streak, nothing private)
create or replace function public.get_leaderboard(limit_n int default 20)
returns table(id uuid, display_name text, current_streak int)
language sql
security definer
stable
as $$
  select id, coalesce(display_name, 'user'), coalesce(current_streak, 0)
  from profiles
  order by current_streak desc nulls last
  limit limit_n;
$$;
grant execute on function public.get_leaderboard to authenticated;

-- Send a partner request by username. Nothing is linked until they accept.
create or replace function public.send_partner_request(friend_username text)
returns text
language plpgsql
security definer
as $$
declare
  friend_id uuid;
  my_count int;
  their_count int;
begin
  select id into friend_id from profiles where lower(display_name) = lower(friend_username) limit 1;
  if friend_id is null then return 'not_found'; end if;
  if friend_id = auth.uid() then return 'self'; end if;

  if exists (
    select 1 from partnerships
    where (requester_id = auth.uid() and recipient_id = friend_id)
       or (requester_id = friend_id and recipient_id = auth.uid())
  ) then
    return 'already';
  end if;

  select count(*) into my_count from partnerships
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid());
  if my_count >= 4 then return 'full'; end if;

  select count(*) into their_count from partnerships
    where status = 'accepted' and (requester_id = friend_id or recipient_id = friend_id);
  if their_count >= 4 then return 'their_full'; end if;

  insert into partnerships (requester_id, recipient_id, status) values (auth.uid(), friend_id, 'pending');
  return 'ok';
end;
$$;
grant execute on function public.send_partner_request to authenticated;

-- Case-insensitive "type ahead" search for the Add Partner box.
-- Matches names that START WITH what's typed (not just contain it
-- anywhere) — so typing "a" only shows names beginning with A.
-- Returns only display_name (nothing private), and never yourself.
create or replace function public.search_users(query text, limit_n int default 8)
returns table(id uuid, display_name text)
language sql
security definer
stable
as $$
  select id, display_name from profiles
  where display_name is not null
    and display_name ilike query || '%'
    and id <> auth.uid()
  order by display_name
  limit limit_n;
$$;
grant execute on function public.search_users to authenticated;

-- Pending requests waiting on the CALLER to accept/decline
create or replace function public.get_my_pending_requests()
returns table(request_id bigint, from_name text)
language sql
security definer
stable
as $$
  select pr.id, coalesce(p.display_name, 'user')
  from partnerships pr
  join profiles p on p.id = pr.requester_id
  where pr.recipient_id = auth.uid() and pr.status = 'pending';
$$;
grant execute on function public.get_my_pending_requests to authenticated;

-- Accept or decline a pending request
create or replace function public.respond_to_partner_request(request_id bigint, accept boolean)
returns void
language plpgsql
security definer
as $$
begin
  if accept then
    update partnerships set status = 'accepted' where id = request_id and recipient_id = auth.uid();
  else
    delete from partnerships where id = request_id and recipient_id = auth.uid();
  end if;
end;
$$;
grant execute on function public.respond_to_partner_request to authenticated;

-- All of the caller's accepted partners, each independent of the others
create or replace function public.get_my_partners()
returns table(partnership_id bigint, user_id uuid, display_name text, current_streak int, link_streaks boolean)
language sql
security definer
stable
as $$
  select pr.id,
         case when pr.requester_id = auth.uid() then pr.recipient_id else pr.requester_id end,
         coalesce(p.display_name, 'user'),
         coalesce(p.current_streak, 0),
         pr.link_streaks
  from partnerships pr
  join profiles p on p.id = (case when pr.requester_id = auth.uid() then pr.recipient_id else pr.requester_id end)
  where pr.status = 'accepted' and (pr.requester_id = auth.uid() or pr.recipient_id = auth.uid());
$$;
grant execute on function public.get_my_partners to authenticated;

-- Remove ONE specific partnership. Either side can do this any time.
create or replace function public.remove_partner(target_partnership_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  delete from partnerships
  where id = target_partnership_id and (requester_id = auth.uid() or recipient_id = auth.uid());
end;
$$;
grant execute on function public.remove_partner to authenticated;

-- Toggle whether ONE specific partnership affects both people's streaks
create or replace function public.set_partner_link_streaks(target_partnership_id bigint, new_val boolean)
returns void
language plpgsql
security definer
as $$
begin
  update partnerships set link_streaks = new_val
  where id = target_partnership_id and (requester_id = auth.uid() or recipient_id = auth.uid());
end;
$$;
grant execute on function public.set_partner_link_streaks to authenticated;

-- Admin-only usage stats
create or replace function public.get_admin_stats()
returns table(total_users bigint, active_today bigint, logins_this_week bigint)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select
    (select count(*) from profiles),
    (select count(distinct user_id) from login_events where logged_at::date = current_date),
    (select count(*) from login_events where logged_at >= now() - interval '7 days');
end;
$$;
grant execute on function public.get_admin_stats to authenticated;

-- ============================================================
-- BASE TABLE GRANTS — required in addition to the RLS policies above.
-- RLS controls which ROWS a role can see/change; these grants control
-- whether the role can touch the TABLE at all. Without these, every
-- query fails with "permission denied for table ..." regardless of
-- what the RLS policies say.
-- ============================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.food_logs to authenticated;
grant select, insert, update, delete on public.saved_meals to authenticated;
grant select, insert, update, delete on public.activity_logs to authenticated;
grant select on public.partnerships to authenticated;
grant insert on public.login_events to authenticated;
grant select on public.foods to authenticated, anon;

-- ============================================================
-- To make yourself an admin, run this once with your own email:
-- update profiles set role = 'admin' where email = 'you@example.com';
--
-- IMPORTANT — for new accounts to log straight in after signing up
-- (no email confirmation step), go to:
-- Supabase Dashboard -> Authentication -> Sign In / Providers -> Email
-- and turn OFF "Confirm email". Without that, Supabase will not hand
-- back an active session right after signUp, and the app has no way
-- to "auto log in" someone whose email isn't confirmed yet.
-- ============================================================
