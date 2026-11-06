create table if not exists public.macro_scorecard (
  id text primary key check (id = 'matrix'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);

alter table public.macro_scorecard enable row level security;
revoke all on public.macro_scorecard from anon, authenticated;
grant select on public.macro_scorecard to anon, authenticated;
grant select, insert, update on public.macro_scorecard to service_role;

drop policy if exists "Read public macro snapshot" on public.macro_scorecard;
create policy "Read public macro snapshot"
  on public.macro_scorecard for select to anon, authenticated
  using (id = 'matrix');
