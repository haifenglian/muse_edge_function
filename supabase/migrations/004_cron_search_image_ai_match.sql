-- 定时任务：每分钟调用 Edge Function search-image-ai-match（图搜匹配 ai_match，5 QPS 调 SearchImage）
-- 依赖：pg_cron、pg_net 已启用（002），Vault 中已有 anon_key

select cron.schedule(
  'search-image-ai-match-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://fxllicysqmrtnpxjvldv.supabase.co/functions/v1/search-image-ai-match',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
