alter table public.wallets
  drop constraint if exists wallets_address_format,
  add constraint wallets_address_format check (address ~ '^0x[0-9a-fA-F]{40}$');

alter table public.wallet_scan_results
  drop constraint if exists wallet_scan_results_wallet_address_format,
  add constraint wallet_scan_results_wallet_address_format check (wallet_address ~ '^0x[0-9a-fA-F]{40}$');

alter table public.bonus_rules
  drop constraint if exists bonus_rules_wallet_address_format,
  drop constraint if exists bonus_rules_token_address_format,
  add constraint bonus_rules_wallet_address_format check (wallet_address is null or wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  add constraint bonus_rules_token_address_format check (token_address is null or token_address ~ '^0x[0-9a-fA-F]{40}$');
