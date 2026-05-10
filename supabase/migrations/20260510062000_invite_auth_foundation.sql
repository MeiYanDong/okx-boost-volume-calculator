create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  max_wallets integer not null default 5 check (max_wallets >= 0),
  daily_refresh_limit integer not null default 3 check (daily_refresh_limit >= 0),
  daily_rescan_limit integer not null default 1 check (daily_rescan_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  email citext,
  role text not null default 'user' check (role in ('admin', 'user')),
  max_wallets integer not null default 5 check (max_wallets >= 0),
  daily_refresh_limit integer not null default 3 check (daily_refresh_limit >= 0),
  daily_rescan_limit integer not null default 1 check (daily_rescan_limit >= 0),
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invites_used_once check (
    (used_at is null and used_by is null) or (used_at is not null and used_by is not null)
  )
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '默认工作区',
  ten_day_target numeric(18, 6) not null default 5000,
  snapshot_hour_utc integer not null default 0 check (snapshot_hour_utc between 0 and 23),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  address text not null,
  name text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_address_format check (address ~ '^0x[0-9a-f]{40}$'),
  unique (workspace_id, address)
);

create table if not exists public.wallet_scan_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  wallet_address text not null,
  snapshot_date date not null,
  window_start date not null,
  window_end date not null,
  boost_volume numeric(24, 8) not null default 0,
  raw_volume numeric(24, 8) not null default 0,
  tx_count integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  source text not null default 'server',
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_scan_results_wallet_address_format check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  unique (workspace_id, wallet_address, snapshot_date)
);

create table if not exists public.bonus_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  wallet_address text,
  token_address text,
  token_symbol text,
  bonus_percent numeric(10, 4) not null default 0,
  effective_from date,
  effective_to date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bonus_rules_wallet_address_format check (wallet_address is null or wallet_address ~ '^0x[0-9a-f]{40}$'),
  constraint bonus_rules_token_address_format check (token_address is null or token_address ~ '^0x[0-9a-f]{40}$'),
  constraint bonus_rules_effective_range check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table if not exists public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  mode text not null check (mode in ('scan', 'refresh', 'rescan', 'cron')),
  status text not null check (status in ('queued', 'running', 'success', 'error')),
  snapshot_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  error text not null default '',
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  refresh_count integer not null default 0 check (refresh_count >= 0),
  rescan_count integer not null default 0 check (rescan_count >= 0),
  rpc_request_count integer not null default 0 check (rpc_request_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create table if not exists public.notification_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  feishu_webhook text not null default '',
  feishu_enabled boolean not null default false,
  notify_future_days integer not null default 3 check (notify_future_days between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_profiles_status_idx on public.app_profiles(status);
create index if not exists invites_email_idx on public.invites(email);
create index if not exists invites_used_by_idx on public.invites(used_by);
create index if not exists workspaces_owner_id_idx on public.workspaces(owner_id);
create index if not exists wallets_workspace_sort_idx on public.wallets(workspace_id, sort_order, created_at);
create index if not exists wallet_scan_results_workspace_snapshot_idx on public.wallet_scan_results(workspace_id, snapshot_date desc);
create index if not exists wallet_scan_results_wallet_snapshot_idx on public.wallet_scan_results(wallet_address, snapshot_date desc);
create index if not exists bonus_rules_workspace_idx on public.bonus_rules(workspace_id, token_address, effective_from, effective_to);
create index if not exists scan_jobs_workspace_created_idx on public.scan_jobs(workspace_id, created_at desc);

drop trigger if exists app_profiles_set_updated_at on public.app_profiles;
create trigger app_profiles_set_updated_at
before update on public.app_profiles
for each row execute function public.set_updated_at();

drop trigger if exists invites_set_updated_at on public.invites;
create trigger invites_set_updated_at
before update on public.invites
for each row execute function public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

drop trigger if exists wallet_scan_results_set_updated_at on public.wallet_scan_results;
create trigger wallet_scan_results_set_updated_at
before update on public.wallet_scan_results
for each row execute function public.set_updated_at();

drop trigger if exists bonus_rules_set_updated_at on public.bonus_rules;
create trigger bonus_rules_set_updated_at
before update on public.bonus_rules
for each row execute function public.set_updated_at();

drop trigger if exists scan_jobs_set_updated_at on public.scan_jobs;
create trigger scan_jobs_set_updated_at
before update on public.scan_jobs
for each row execute function public.set_updated_at();

drop trigger if exists usage_daily_set_updated_at on public.usage_daily;
create trigger usage_daily_set_updated_at
before update on public.usage_daily
for each row execute function public.set_updated_at();

drop trigger if exists notification_settings_set_updated_at on public.notification_settings;
create trigger notification_settings_set_updated_at
before update on public.notification_settings
for each row execute function public.set_updated_at();

create or replace function public.current_user_owns_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces
    where id = target_workspace_id
      and owner_id = auth.uid()
  );
$$;

alter table public.app_profiles enable row level security;
alter table public.invites enable row level security;
alter table public.workspaces enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_scan_results enable row level security;
alter table public.bonus_rules enable row level security;
alter table public.scan_jobs enable row level security;
alter table public.usage_daily enable row level security;
alter table public.notification_settings enable row level security;

drop policy if exists app_profiles_select_own on public.app_profiles;
create policy app_profiles_select_own
on public.app_profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists workspaces_select_own on public.workspaces;
create policy workspaces_select_own
on public.workspaces
for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists workspaces_insert_own on public.workspaces;
create policy workspaces_insert_own
on public.workspaces
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists workspaces_update_own on public.workspaces;
create policy workspaces_update_own
on public.workspaces
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists workspaces_delete_own on public.workspaces;
create policy workspaces_delete_own
on public.workspaces
for delete
to authenticated
using (owner_id = auth.uid());

drop policy if exists wallets_select_own_workspace on public.wallets;
create policy wallets_select_own_workspace
on public.wallets
for select
to authenticated
using (public.current_user_owns_workspace(workspace_id));

drop policy if exists wallets_insert_own_workspace on public.wallets;
create policy wallets_insert_own_workspace
on public.wallets
for insert
to authenticated
with check (public.current_user_owns_workspace(workspace_id));

drop policy if exists wallets_update_own_workspace on public.wallets;
create policy wallets_update_own_workspace
on public.wallets
for update
to authenticated
using (public.current_user_owns_workspace(workspace_id))
with check (public.current_user_owns_workspace(workspace_id));

drop policy if exists wallets_delete_own_workspace on public.wallets;
create policy wallets_delete_own_workspace
on public.wallets
for delete
to authenticated
using (public.current_user_owns_workspace(workspace_id));

drop policy if exists wallet_scan_results_select_own_workspace on public.wallet_scan_results;
create policy wallet_scan_results_select_own_workspace
on public.wallet_scan_results
for select
to authenticated
using (public.current_user_owns_workspace(workspace_id));

drop policy if exists bonus_rules_manage_own_workspace on public.bonus_rules;
create policy bonus_rules_manage_own_workspace
on public.bonus_rules
for all
to authenticated
using (public.current_user_owns_workspace(workspace_id))
with check (public.current_user_owns_workspace(workspace_id));

drop policy if exists scan_jobs_select_own_workspace on public.scan_jobs;
create policy scan_jobs_select_own_workspace
on public.scan_jobs
for select
to authenticated
using (public.current_user_owns_workspace(workspace_id));

drop policy if exists usage_daily_select_own on public.usage_daily;
create policy usage_daily_select_own
on public.usage_daily
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists notification_settings_manage_own_workspace on public.notification_settings;
create policy notification_settings_manage_own_workspace
on public.notification_settings
for all
to authenticated
using (public.current_user_owns_workspace(workspace_id))
with check (public.current_user_owns_workspace(workspace_id));
