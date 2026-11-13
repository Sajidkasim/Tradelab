-- Run after 01-schema.sql on a disposable Supabase database as its owner.
begin;
insert into auth.users (id) values
  ('c0e00000-0000-4000-8000-000000000001'),
  ('c0e00000-0000-4000-8000-000000000002');

insert into public.habit_events (user_id, event_type, source_id, verified)
values ('c0e00000-0000-4000-8000-000000000002', 'backtest_active_minutes', 'test-source', true);
insert into public.habit_events (user_id, event_type, source_id, verified)
values ('c0e00000-0000-4000-8000-000000000002', 'backtest_active_minutes', 'test-source', true)
on conflict (user_id, event_type, source_id) do nothing;

insert into public.daily_habit_summary (user_id, local_date, prep_score, execute_score, study_score)
values ('c0e00000-0000-4000-8000-000000000001', current_date, 30, 40, 30),
       ('c0e00000-0000-4000-8000-000000000002', current_date, 15, 20, 15);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0e00000-0000-4000-8000-000000000001', true);

insert into public.user_habit_settings (timezone) values ('Pacific/Auckland');
insert into public.habit_events (event_type) values ('mindset_completed');

do $$
begin
  if (select count(*) from public.habit_events) <> 1
     or (select bool_or(verified) from public.habit_events) then
    raise exception 'Event isolation or verification default failed';
  end if;
  if (select array_agg(total_score) from public.daily_habit_summary) is distinct from array[100]::smallint[] then
    raise exception 'Summary isolation or generated total failed';
  end if;
  if public.habit_today() is distinct from (now() at time zone 'Pacific/Auckland')::date then
    raise exception 'Local date resolution failed';
  end if;

  begin
    insert into public.habit_events (event_type, verified) values ('mindset_completed', true);
    raise exception 'Browser could verify its own event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.habit_events (event_type, user_id)
    values ('mindset_completed', 'c0e00000-0000-4000-8000-000000000002');
    raise exception 'Browser could impersonate another user';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.daily_habit_summary set prep_score = 0;
    raise exception 'Browser could write a summary';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_habit_settings set timezone = 'not-a-timezone';
    raise exception 'Invalid timezone was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from public.habit_events where verified and source_id = 'test-source') <> 1 then
    raise exception 'Source idempotency failed';
  end if;
end;
$$;
rollback;
