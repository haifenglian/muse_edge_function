-- 定时任务：每分钟调用 Edge Function sync-social-media-cube-to-supabase
-- 依赖：pg_cron、pg_net 已启用（002），Vault 中已有 anon_key

select cron.schedule(
  'sync-social-media-cube-to-supabase-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://fxllicysqmrtnpxjvldv.supabase.co/functions/v1/sync-social-media-cube-to-supabase',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- 定时任务：每分钟调用 Edge Function consume-social-media-subject-tasks
-- 依赖：pg_cron、pg_net 已启用（002），Vault 中已有 anon_key

select cron.schedule(
  'consume-social-media-subject-tasks-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://fxllicysqmrtnpxjvldv.supabase.co/functions/v1/consume-social-media-subject-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
