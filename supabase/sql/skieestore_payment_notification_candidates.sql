-- SKIEESTORE: unverified merchant notification inbox.
-- Apply in Supabase SQL Editor. This table is NOT a payment ledger.
create table if not exists public.xpaypoint_payment_notification_candidates (
  id uuid primary key default gen_random_uuid(),
  source_package text not null,
  title text not null default '',
  body_text text not null default '',
  big_text text not null default '',
  received_at timestamptz,
  notification_key text not null unique,
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified','reviewed','rejected')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists xpaypoint_notification_candidates_created_idx
  on public.xpaypoint_payment_notification_candidates (created_at desc);

alter table public.xpaypoint_payment_notification_candidates enable row level security;
revoke all on public.xpaypoint_payment_notification_candidates from anon, authenticated;
grant all on public.xpaypoint_payment_notification_candidates to service_role;

comment on table public.xpaypoint_payment_notification_candidates is
  'Unverified Android merchant notification candidates only; never proof of payment and never triggers fulfillment.';
