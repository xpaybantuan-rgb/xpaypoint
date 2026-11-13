-- Make VIPayment callback deduplication NULL-safe.
alter table public.skieepay_vipayment_events
  drop constraint if exists skieepay_vipayment_events_trxid_status_note_key;
create unique index if not exists skieepay_vipayment_events_dedupe_uidx
  on public.skieepay_vipayment_events(trxid, status, coalesce(note, ''));

-- Ensure the RPC remains callable only by the server role.
revoke all on function public.skieepay_apply_vipayment_callback(text,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.skieepay_apply_vipayment_callback(text,text,text,bigint,jsonb) to service_role;
