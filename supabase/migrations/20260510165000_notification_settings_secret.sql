alter table public.notification_settings
add column if not exists feishu_secret text not null default '';
