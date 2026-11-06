-- Apply in the Supabase SQL editor for the Primus project before enabling the room.
begin;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'primus_bullpen') then
    create role primus_bullpen nologin noinherit;
  end if;
end $$;

grant primus_bullpen to authenticator;
grant usage on schema realtime to primus_bullpen;
grant usage on schema auth to primus_bullpen;
grant execute on function auth.jwt() to primus_bullpen;
grant select, insert on realtime.messages to primus_bullpen;
grant execute on function realtime.topic() to primus_bullpen;

-- The restrictive policy prevents a broad pre-existing policy from opening
-- this topic to ordinary users. Other topics retain their existing rules.
drop policy if exists primus_bullpen_scope on realtime.messages;
create policy primus_bullpen_scope on realtime.messages as restrictive for all to public
using (
  coalesce(realtime.topic(), '') <> 'primus:bullpen:v1'
  or (current_user = 'primus_bullpen' and auth.jwt()->>'primus_bullpen' = 'true')
)
with check (
  coalesce(realtime.topic(), '') <> 'primus:bullpen:v1'
  or (current_user = 'primus_bullpen' and auth.jwt()->>'primus_bullpen' = 'true')
);

drop policy if exists primus_bullpen_read on realtime.messages;
create policy primus_bullpen_read on realtime.messages for select to primus_bullpen
using (realtime.topic() = 'primus:bullpen:v1' and extension in ('broadcast','presence')
  and auth.jwt()->>'primus_bullpen' = 'true');

drop policy if exists primus_bullpen_send on realtime.messages;
create policy primus_bullpen_send on realtime.messages for insert to primus_bullpen
with check (realtime.topic() = 'primus:bullpen:v1' and extension in ('broadcast','presence')
  and auth.jwt()->>'primus_bullpen' = 'true');
commit;
