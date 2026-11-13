-- Run after both migrations on a disposable Supabase database as its owner.
begin;
insert into auth.users (id, created_at) values
  ('c0e00000-0000-4000-8000-000000000001', now() - interval '20 days'),
  ('c0e00000-0000-4000-8000-000000000002', now() - interval '20 days');

insert into public.user_habit_settings (user_id, timezone, rest_days, created_at)
values ('c0e00000-0000-4000-8000-000000000001', 'UTC', '{}', now() - interval '10 days');

set local timezone = 'UTC';

-- One verified row represents one observed active minute; metadata cannot mint minutes.
insert into public.habit_events (user_id, event_type, occurred_at, source_id, verified)
select 'c0e00000-0000-4000-8000-000000000001', 'backtest_active_minutes',
  (current_date - 8)::timestamptz + minute * interval '1 minute', minute::text, true
from generate_series(1, 600) as active(minute);

insert into public.habit_events (user_id, event_type, occurred_at, source_id, verified, metadata)
select 'c0e00000-0000-4000-8000-000000000001', kind,
  (current_date - 8)::timestamptz, kind, true, details::jsonb
from (values
  ('prep_checklist_completed', '{}'), ('mindset_completed', '{}'),
  ('journal_entry_saved', '{"pre_trade_plan_filled":true}'),
  ('plan_followed_confirmed', '{}'), ('no_trade_day_confirmed', '{}'),
  ('strategy_lab_review', '{"reviewed_trade_count":5}')
) as evidence(kind, details);

insert into public.habit_events (user_id, event_type, occurred_at, source_id, verified, metadata)
select 'c0e00000-0000-4000-8000-000000000001', kind,
  (current_date - 7)::timestamptz, 'negative-' || kind, trusted, details::jsonb
from (values
  ('journal_entry_saved', true, '{"pre_trade_plan_filled":false}'),
  ('strategy_lab_review', true, '{"reviewed_trade_count":4}'),
  ('backtest_active_minutes', true, '{"minutes":600}'),
  ('mindset_completed', false, '{}')
) as evidence(kind, trusted, details);

do $$
begin
  if (select study_score from public.daily_habit_summary
      where user_id = 'c0e00000-0000-4000-8000-000000000001' and local_date = current_date - 8) is distinct from 30 then
    raise exception 'Ten hours of replay must contribute only 15 alongside the 15 for Lab';
  end if;
  if (select total_score from public.daily_habit_summary
      where user_id = 'c0e00000-0000-4000-8000-000000000001' and local_date = current_date - 8) is distinct from 100 then
    raise exception 'Daily cap or shared plan/no-trade award failed';
  end if;
  if (select total_score from public.daily_habit_summary
      where user_id = 'c0e00000-0000-4000-8000-000000000001' and local_date = current_date - 7) is distinct from 0 then
    raise exception 'Unsupported evidence earned points';
  end if;
end;
$$;

-- Isolate streak cases from the scoring fixtures.
delete from public.daily_habit_summary
where user_id = 'c0e00000-0000-4000-8000-000000000001';
insert into public.daily_habit_summary (user_id, local_date, prep_score, execute_score, study_score, streak_kept)
select 'c0e00000-0000-4000-8000-000000000001', current_date - offset_day, 30, 20, 0, true
from (values (4), (2)) as days(offset_day);
insert into compound_edge.market_holidays values (current_date - 3, 'Test closure');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0e00000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select current_streak from public.habit_streak()) is distinct from 2 then
    raise exception 'Holiday, one miss or unfinished today broke the streak';
  end if;
  begin
    perform compound_edge.recalculate_daily_summary('c0e00000-0000-4000-8000-000000000002', current_date);
    raise exception 'Browser could recalculate a summary';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
delete from compound_edge.market_holidays where local_date = current_date - 3;
delete from public.daily_habit_summary where local_date = current_date - 2
  and user_id = 'c0e00000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  if (select current_streak from public.habit_streak()) is distinct from 0
     or (select longest_streak from public.habit_streak()) is distinct from 1 then
    raise exception 'Two consecutive qualifying misses did not reset the streak';
  end if;
end;
$$;
rollback;
