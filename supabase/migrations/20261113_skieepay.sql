-- SkieePay foundation schema for Supabase
-- Safe to apply as a new migration; does not modify XPAYPOINT checkout tables.
create extension if not exists pgcrypto;

create table if not exists public.skieepay_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_code text not null unique,
  order_id uuid,
  customer_ref text,
  amount bigint not null check (amount > 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  status text not null default 'pending' check (status in ('pending','paid','expired','cancelled','failed')),
  payment_method text,
  payment_payload text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists skieepay_invoices_status_created_idx
  on public.skieepay_invoices(status, created_at desc);
create index if not exists skieepay_invoices_order_idx
  on public.skieepay_invoices(order_id) where order_id is not null;

create table if not exists public.skieepay_payment_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.skieepay_invoices(id),
  source text not null,
  external_event_id text,
  event_type text not null,
  amount bigint,
  payload jsonb not null default '{}'::jsonb,
  verified boolean not null default false,
  received_at timestamptz not null default now(),
  unique(source, external_event_id)
);
create index if not exists skieepay_events_invoice_idx
  on public.skieepay_payment_events(invoice_id, received_at desc);

create table if not exists public.skieepay_ledger (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.skieepay_invoices(id),
  entry_type text not null check (entry_type in ('payment_pending','payment_confirmed','payment_reversed','fulfillment_requested')),
  amount bigint not null,
  reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists skieepay_ledger_invoice_idx
  on public.skieepay_ledger(invoice_id, created_at);

alter table public.skieepay_invoices enable row level security;
alter table public.skieepay_payment_events enable row level security;
alter table public.skieepay_ledger enable row level security;
-- No public write/read policies: all mutations and privileged reads must go through
-- a server-side Cloudflare Worker using a secret stored as an environment variable.
