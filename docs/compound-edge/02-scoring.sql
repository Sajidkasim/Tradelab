-- Apply after 01-schema.sql as the database owner.
begin;

create schema compound_edge;
revoke all on schema compound_edge from public, anon, authenticated;

-- Full market closures supplied by the backend. Early closes are regular days.
create table compound_edge.market_holidays (
  local_date date primary key,
  name text not null check (btrim(name) <> '')
);
revoke all on compound_edge.market_holidays from public, anon, authenticated;
grant usage on schema compound_edge to service_role;
grant select, insert, update, delete on compound_edge.market_holidays to service_role;

create function compound_edge.recalculate_daily_summary(p_user_id uuid, p_local_date date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  zone text;
  prepare integer;
  execute_points integer;
  study integer;
begin
  -- Serialize rebuilding and timezone changes for this user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('compound-edge:' || p_user_id::text, 0));

  select coalesce(
    (select timezone from public.user_habit_settings where user_id = p_user_id),
    'America/New_York'
  ) into zone;

  select
    least(30,
      15 * (count(*) filter (where event_type = 'prep_checklist_completed') > 0)::integer
      + 15 * (count(*) filter (where event_type = 'mindset_completed') > 0)::integer),
    least(40,
      20 * (count(*) filter (where event_type = 'journal_entry_saved'
        and metadata @> '{"pre_trade_plan_filled":true}') > 0)::integer
      + 20 * (count(*) filter (where event_type in (
        'plan_followed_confirmed', 'no_trade_day_confirmed')) > 0)::integer),
    least(30,
      15 * (count(distinct date_trunc('minute', occurred_at, 'UTC'))
        filter (where event_type = 'backtest_active_minutes') >= 20)::integer
      + 15 * (count(*) filter (where event_type = 'strategy_lab_review' and (
        metadata @> '{"note_saved":true}'
        or (metadata->>'reviewed_trade_count' ~ '^[0-9]{1,9}$'
          and metadata->'reviewed_trade_count' >= '5'::jsonb
          and jsonb_typeof(metadata->'reviewed_trade_count') = 'number')
      )) > 0)::integer)
  into prepare, execute_points, study
  from public.habit_events
  where user_id = p_user_id and verified
    and occurred_at >= (p_local_date::timestamp at time zone zone)
    and occurred_at < ((p_local_date + 1)::timestamp at time zone zone)
    and occurred_at <= statement_timestamp();

  insert into public.daily_habit_summary (
    user_id, local_date, prep_score, execute_score, study_score, streak_kept
  ) values (
    p_user_id, p_local_date, prepare, execute_points, study,
    least(100, prepare + execute_points + study) >= 50
  )
  on conflict (user_id, local_date) do update set
    prep_score = excluded.prep_score,
    execute_score = excluded.execute_score,
    study_score = excluded.study_score,
    streak_kept = excluded.streak_kept,
    updated_at = statement_timestamp();
end;
$$;

create function compound_edge.score_verified_event()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  zone text;
begin
  if new.occurred_at > statement_timestamp() then
    raise exception 'Verified habit events must have already occurred.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('compound-edge:' || new.user_id::text, 0));
  select coalesce(
    (select timezone from public.user_habit_settings where user_id = new.user_id),
    'America/New_York'
  ) into zone;
  perform compound_edge.recalculate_daily_summary(new.user_id, (new.occurred_at at time zone zone)::date);
  return new;
end;
$$;

create trigger score_verified_habit_event
after insert on public.habit_events
for each row when (new.verified) execute function compound_edge.score_verified_event();

-- Re-bucket existing verified events when the user chooses a different timezone.
create function compound_edge.rebuild_after_timezone_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  event_day date;
begin
  if tg_op = 'UPDATE' and new.timezone = old.timezone then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('compound-edge:' || new.user_id::text, 0));
  delete from public.daily_habit_summary where user_id = new.user_id;
  for event_day in
    select distinct (occurred_at at time zone new.timezone)::date
    from public.habit_events where user_id = new.user_id and verified
  loop
    perform compound_edge.recalculate_daily_summary(new.user_id, event_day);
  end loop;
  return new;
end;
$$;

create trigger rebuild_habits_after_timezone_change
after insert or update of timezone on public.user_habit_settings
for each row execute function compound_edge.rebuild_after_timezone_change();

-- Evaluate empty days at read time so streaks stay current even with no activity.
-- A successful rest day can earn points, but it does not lengthen the streak.
create function public.habit_streak()
returns table (current_streak integer, longest_streak integer, days_kept_this_year integer)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  member uuid := (select auth.uid());
  zone text;
  days_off smallint[];
  first_day date;
  today date;
  day record;
  missed integer := 0;
begin
  if member is null then
    return;
  end if;
  select coalesce(s.timezone, 'America/New_York'),
    coalesce(s.rest_days, array[6, 7]::smallint[]),
    (coalesce(s.created_at, u.created_at, now()) at time zone coalesce(s.timezone, 'America/New_York'))::date
  into zone, days_off, first_day
  from auth.users u left join public.user_habit_settings s on s.user_id = u.id
  where u.id = member;
  today := (now() at time zone zone)::date;
  current_streak := 0;
  longest_streak := 0;
  days_kept_this_year := 0;

  for day in
    select first_day + offset_day as local_date, coalesce(summary.streak_kept, false) as kept
    from generate_series(0, today - first_day) as offsets(offset_day)
    left join public.daily_habit_summary summary
      on summary.user_id = member and summary.local_date = first_day + offset_day
    left join compound_edge.market_holidays holiday on holiday.local_date = first_day + offset_day
    where not (extract(isodow from first_day + offset_day)::smallint = any(days_off))
      and holiday.local_date is null
    order by first_day + offset_day
  loop
    if day.kept then
      missed := 0;
      current_streak := current_streak + 1;
      longest_streak := greatest(longest_streak, current_streak);
      if day.local_date >= date_trunc('year', today::timestamp)::date then
        days_kept_this_year := days_kept_this_year + 1;
      end if;
    elsif day.local_date < today then
      missed := missed + 1;
      if missed >= 2 then
        current_streak := 0;
      end if;
    end if;
  end loop;
  return next;
end;
$$;

revoke all on all functions in schema compound_edge from public, anon, authenticated, service_role;
grant execute on function compound_edge.recalculate_daily_summary(uuid, date) to service_role;
revoke all on function public.habit_streak() from public, anon, authenticated, service_role;
grant execute on function public.habit_streak() to authenticated;

-- Let the function and verified events be the only ordinary summary write path.
revoke insert, update on public.daily_habit_summary from service_role;

-- Cover any trusted events recorded before this migration was installed.
do $$
declare
  item record;
begin
  for item in
    select distinct e.user_id, (e.occurred_at at time zone coalesce(s.timezone, 'America/New_York'))::date as day
    from public.habit_events e left join public.user_habit_settings s using (user_id)
    where e.verified and e.occurred_at <= statement_timestamp()
  loop
    perform compound_edge.recalculate_daily_summary(item.user_id, item.day);
  end loop;
end;
$$;

commit;
