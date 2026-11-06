-- Apply after BULLPEN_REALTIME.sql.
begin;
drop policy if exists primus_bullpen_alert_read_scope on realtime.messages;
create policy primus_bullpen_alert_read_scope on realtime.messages as restrictive for select to public
using (
  coalesce(realtime.topic(), '') <> 'primus:bullpen:alerts:v1'
  or (current_user = 'primus_bullpen' and auth.jwt()->>'primus_bullpen' = 'true')
);
drop policy if exists primus_bullpen_alert_send_scope on realtime.messages;
create policy primus_bullpen_alert_send_scope on realtime.messages as restrictive for insert to public
with check (coalesce(realtime.topic(), '') <> 'primus:bullpen:alerts:v1');
drop policy if exists primus_bullpen_alert_read on realtime.messages;
create policy primus_bullpen_alert_read on realtime.messages for select to primus_bullpen
using (realtime.topic() = 'primus:bullpen:alerts:v1' and extension = 'broadcast'
  and auth.jwt()->>'primus_bullpen' = 'true');
commit;
