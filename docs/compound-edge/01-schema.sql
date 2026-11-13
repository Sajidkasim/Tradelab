-- Apply as the database owner on Supabase. This migration creates only habit tables.
begin;

create table public.user_habit_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  timezone text not null default 'America/New_York',
  -- ISO weekdays: Monday = 1, Sunday = 7.
  rest_days smallint[] not null default array[6, 7]::smallint[],
  created_at timestamptz not null default now(),
  check (cardinality(rest_days) <= 7
    and rest_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    and array_position(rest_days, null::smallint) is null)
);

create function public.validate_habit_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception 'Choose a valid timezone name.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_habit_timezone() from public, anon, authenticated;

create trigger validate_habit_timezone
before insert or update of timezone on public.user_habit_settings
for each row execute function public.validate_habit_timezone();

create table public.habit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'prep_checklist_completed', 'mindset_completed', 'journal_entry_saved',
    'plan_followed_confirmed', 'no_trade_day_confirmed',
    'backtest_active_minutes', 'strategy_lab_review'
  )),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  source_id text check (char_length(btrim(source_id)) between 1 and 160),
  verified boolean not null default false,
  check (not verified or source_id is not null),
  unique (user_id, event_type, source_id)
);

create index habit_events_user_time on public.habit_events (user_id, occurred_at);

create table public.daily_habit_summary (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  prep_score smallint not null check (prep_score between 0 and 30),
  execute_score smallint not null check (execute_score between 0 and 40),
  study_score smallint not null check (study_score between 0 and 30),
  total_score smallint generated always as (prep_score + execute_score + study_score) stored
    check (total_score between 0 and 100),
  streak_kept boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table public.user_habit_settings enable row level security;
alter table public.habit_events enable row level security;
alter table public.daily_habit_summary enable row level security;

revoke all on public.user_habit_settings, public.habit_events, public.daily_habit_summary
from public, anon, authenticated, service_role;

grant select on public.user_habit_settings, public.habit_events, public.daily_habit_summary
to authenticated;
grant insert (timezone, rest_days), update (timezone, rest_days)
on public.user_habit_settings to authenticated;
-- Only the backend can record trusted evidence and assign its idempotency key.
grant insert (event_type, metadata) on public.habit_events to authenticated;

grant select, insert, update on public.user_habit_settings, public.daily_habit_summary to service_role;
grant select, insert on public.habit_events to service_role;

create policy habit_settings_read_own on public.user_habit_settings
for select to authenticated using (user_id = (select auth.uid()));
create policy habit_settings_insert_own on public.user_habit_settings
for insert to authenticated with check (user_id = (select auth.uid()));
create policy habit_settings_update_own on public.user_habit_settings
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy habit_events_read_own on public.habit_events
for select to authenticated using (user_id = (select auth.uid()));
create policy habit_events_insert_own on public.habit_events
for insert to authenticated with check (
  user_id = (select auth.uid()) and not verified and source_id is null
);
create policy habit_summary_read_own on public.daily_habit_summary
for select to authenticated using (user_id = (select auth.uid()));

-- Invoker rights enforce the same settings policy as a normal SELECT.
create function public.habit_today()
returns date
language sql stable security invoker
set search_path = ''
as $$
  select case when (select auth.uid()) is not null then
    (now() at time zone coalesce(
      (select timezone from public.user_habit_settings where user_id = (select auth.uid())),
      'America/New_York'
    ))::date
  end
$$;

revoke all on function public.habit_today() from public, anon, authenticated;
grant execute on function public.habit_today() to authenticated;

commit;
