grant usage on schema public to authenticated, service_role;

grant select on public.app_profiles to authenticated;

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.wallets to authenticated;
grant select on public.wallet_scan_results to authenticated;
grant select, insert, update, delete on public.bonus_rules to authenticated;
grant select on public.scan_jobs to authenticated;
grant select on public.usage_daily to authenticated;
grant select, insert, update, delete on public.notification_settings to authenticated;

grant all privileges on public.app_profiles to service_role;
grant all privileges on public.invites to service_role;
grant all privileges on public.workspaces to service_role;
grant all privileges on public.wallets to service_role;
grant all privileges on public.wallet_scan_results to service_role;
grant all privileges on public.bonus_rules to service_role;
grant all privileges on public.scan_jobs to service_role;
grant all privileges on public.usage_daily to service_role;
grant all privileges on public.notification_settings to service_role;

revoke all on public.invites from anon, authenticated;
revoke all on public.app_profiles from anon;
revoke all on public.workspaces from anon;
revoke all on public.wallets from anon;
revoke all on public.wallet_scan_results from anon;
revoke all on public.bonus_rules from anon;
revoke all on public.scan_jobs from anon;
revoke all on public.usage_daily from anon;
revoke all on public.notification_settings from anon;
