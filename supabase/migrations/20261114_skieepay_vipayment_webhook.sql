-- SkieePay VIPayment fulfillment callback support
alter table public.skieepay_invoices
  add column if not exists vipayment_trxid text,
  add column if not exists fulfillment_status text
    check (fulfillment_status is null or fulfillment_status in ('waiting','processing','success','error')),
  add column if not exists fulfillment_note text,
  add column if not exists fulfillment_price bigint,
  add column if not exists fulfilled_at timestamptz;

create unique index if not exists skieepay_invoices_vipayment_trxid_uidx
  on public.skieepay_invoices(vipayment_trxid)
  where vipayment_trxid is not null;

create table if not exists public.skieepay_vipayment_events (
  id uuid primary key default gen_random_uuid(),
  trxid text not null,
  status text not null check (status in ('waiting','processing','success','error')),
  note text,
  price bigint,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique(trxid, status, note)
);
alter table public.skieepay_vipayment_events enable row level security;

create or replace function public.skieepay_apply_vipayment_callback(
  p_trxid text,
  p_status text,
  p_note text default null,
  p_price bigint default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_inserted integer;
begin
  if p_trxid is null or length(trim(p_trxid)) = 0 then
    raise exception 'trxid is required';
  end if;
  if p_status not in ('waiting','processing','success','error') then
    raise exception 'invalid VIPayment status';
  end if;

  insert into public.skieepay_vipayment_events(trxid,status,note,price,payload)
  values (p_trxid,p_status,p_note,p_price,coalesce(p_payload,'{}'::jsonb))
  on conflict (trxid,status,note) do nothing;
  get diagnostics v_inserted = row_count;

  update public.skieepay_invoices
  set fulfillment_status = p_status,
      fulfillment_note = p_note,
      fulfillment_price = coalesce(p_price, fulfillment_price),
      fulfilled_at = case when p_status in ('success','error') then now() else fulfilled_at end,
      updated_at = now()
  where vipayment_trxid = p_trxid
  returning id into v_invoice_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', v_inserted = 0,
    'matched', v_invoice_id is not null,
    'invoice_id', v_invoice_id,
    'status', p_status
  );
end;
$$;

revoke all on function public.skieepay_apply_vipayment_callback(text,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.skieepay_apply_vipayment_callback(text,text,text,bigint,jsonb) to service_role;
