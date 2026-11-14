-- SkieePay private multi-business foundation.
-- The first owned business is XPAYPOINT; no public merchant onboarding is created.

create table if not exists public.skieepay_businesses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skieepay_businesses_code_format check (code = lower(code) and code ~ '^[a-z0-9][a-z0-9_-]{1,39}$')
);

insert into public.skieepay_businesses (code, name, status)
values ('xpaypoint', 'XPAYPOINT', 'active')
on conflict (code) do update set name = excluded.name, status = 'active', updated_at = now();

alter table public.skieepay_invoices add column if not exists business_id uuid;

update public.skieepay_invoices
set business_id = (select id from public.skieepay_businesses where code = 'xpaypoint')
where business_id is null;

alter table public.skieepay_invoices alter column business_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'skieepay_invoices_business_id_fkey'
      and conrelid = 'public.skieepay_invoices'::regclass
  ) then
    alter table public.skieepay_invoices
      add constraint skieepay_invoices_business_id_fkey
      foreign key (business_id) references public.skieepay_businesses(id)
      on update restrict on delete restrict;
  end if;
end $$;

create index if not exists idx_skieepay_invoices_business_created
  on public.skieepay_invoices (business_id, created_at desc);

alter table public.skieepay_businesses enable row level security;
revoke all on table public.skieepay_businesses from anon, authenticated;
grant select on table public.skieepay_businesses to authenticated;
grant all on table public.skieepay_businesses to service_role;

drop policy if exists skieepay_businesses_owner_read on public.skieepay_businesses;
create policy skieepay_businesses_owner_read
on public.skieepay_businesses
for select to authenticated
using (
  exists (
    select 1 from public.xpaypoint_admins a
    where a.user_id = (select auth.uid())
  )
);

comment on table public.skieepay_businesses is
  'Private business registry for the owner''s own businesses. Not a public merchant marketplace.';
comment on column public.skieepay_invoices.business_id is
  'Owning private business for this invoice; legacy invoices were assigned to XPAYPOINT.';
