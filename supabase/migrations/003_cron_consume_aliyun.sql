-- 定时任务：每分钟调用 Edge Function consume-aliyun-sync-tasks（消费 pending 任务，5 QPS 调阿里云 AddImage）
-- 依赖：pg_cron、pg_net 已启用（002），Vault 中已有 anon_key

select cron.schedule(
  'consume-aliyun-sync-tasks-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://fxllicysqmrtnpxjvldv.supabase.co/functions/v1/consume-aliyun-sync-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
