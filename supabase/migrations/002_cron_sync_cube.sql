-- 定时任务：每分钟调用 Edge Function sync-cube-to-supabase
-- 依赖：pg_cron、pg_net。若报 schema "cron" does not exist 或无权限创建扩展：
--   请先在 Supabase Dashboard → Database → Extensions 中启用 pg_cron 和 pg_net，再重新执行本迁移后半段（从 select cron.schedule 开始）
-- 执行前请在 Vault 中创建 anon_key，否则 cron 调用会失败：
--   select vault.create_secret('你的 Supabase anon key', 'anon_key');

-- pg_cron 会创建 cron schema，需在 Dashboard → Database → Extensions 中先启用 pg_cron（若无权限用 SQL 启用）
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

select cron.schedule(
  'sync-cube-to-supabase-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://fxllicysqmrtnpxjvldv.supabase.co/functions/v1/sync-cube-to-supabase',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
