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

-- ---------- accountability groups (up to 4 members) ----------
create table if not exists accountability_groups (
  id bigint generated always as identity primary key,
  link_streaks boolean default true,
  created_by uuid references auth.users(id)
);

create table if not exists group_members (
  group_id bigint references accountability_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (group_id, user_id)
);

alter table accountability_groups enable row level security;
alter table group_members enable row level security;

drop policy if exists "groups_member_select" on accountability_groups;
create policy "groups_member_select" on accountability_groups
  for select using (
    id in (select group_id from group_members where user_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "group_members_select" on group_members;
create policy "group_members_select" on group_members
  for select using (
    group_id in (select group_id from group_members where user_id = auth.uid())
    or public.is_admin()
  );

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

-- Recalculate + store the caller's own streak
create or replace function public.recompute_my_streak()
returns int
language plpgsql
security definer
as $$
declare
  d date := current_date;
  goal numeric;
  gtype text;
  total numeric;
  streak int := 0;
  buffer int := 50;
  on_goal boolean;
begin
  select calorie_goal, goal_type into goal, gtype from profiles where id = auth.uid();
  if goal is null then goal := 2000; end if;
  if gtype is null then gtype := 'maintain'; end if;

  loop
    select coalesce(sum(calories),0) into total from food_logs
      where user_id = auth.uid() and log_date = d;
    exit when total = 0;

    if gtype = 'lose' then
      on_goal := total <= goal + buffer;
    elsif gtype in ('gain','muscle') then
      on_goal := total >= goal - buffer;
    else
      on_goal := abs(total - goal) <= buffer;
    end if;

    exit when not on_goal;
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

-- Add an accountability partner by their display name / username
-- (no email lookup — keeps this simple, with no email verification involved)
create or replace function public.add_accountability_partner(friend_username text)
returns text
language plpgsql
security definer
as $$
declare
  friend_id uuid;
  my_group_id bigint;
  member_count int;
begin
  select id into friend_id from profiles where lower(display_name) = lower(friend_username) limit 1;
  if friend_id is null then return 'not_found'; end if;
  if friend_id = auth.uid() then return 'self'; end if;

  select group_id into my_group_id from group_members where user_id = auth.uid() limit 1;
  if my_group_id is null then
    insert into accountability_groups (created_by) values (auth.uid()) returning id into my_group_id;
    insert into group_members (group_id, user_id) values (my_group_id, auth.uid());
  end if;

  select count(*) into member_count from group_members where group_id = my_group_id;
  if member_count >= 4 then return 'full'; end if;

  if exists (select 1 from group_members where group_id = my_group_id and user_id = friend_id) then
    return 'already';
  end if;

  insert into group_members (group_id, user_id) values (my_group_id, friend_id);
  return 'ok';
end;
$$;
grant execute on function public.add_accountability_partner to authenticated;

-- Get the caller's own accountability group (members + settings)
create or replace function public.get_my_group()
returns table(group_id bigint, link_streaks boolean, user_id uuid, display_name text, current_streak int)
language sql
security definer
stable
as $$
  select g.id, g.link_streaks, p.id, coalesce(p.display_name,'user'), coalesce(p.current_streak,0)
  from group_members gm
  join accountability_groups g on g.id = gm.group_id
  join profiles p on p.id = gm.user_id
  where gm.group_id = (select group_id from group_members where user_id = auth.uid() limit 1);
$$;
grant execute on function public.get_my_group to authenticated;

-- Toggle the "link streaks" setting for the caller's group
create or replace function public.set_link_streaks(new_val boolean)
returns void
language plpgsql
security definer
as $$
declare gid bigint;
begin
  select group_id into gid from group_members where user_id = auth.uid() limit 1;
  if gid is not null then
    update accountability_groups set link_streaks = new_val where id = gid;
  end if;
end;
$$;
grant execute on function public.set_link_streaks to authenticated;

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
