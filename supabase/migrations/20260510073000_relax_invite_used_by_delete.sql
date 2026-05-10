alter table public.invites
  drop constraint if exists invites_used_once,
  add constraint invites_used_consistent check (used_by is null or used_at is not null);
