# muse_edge_function

muse 的后端服务。

## 环境

- **Python**：3.11 / 3.12 / 3.14 均可（同步脚本用 requests 直连 Supabase REST API，不依赖 supabase/httpx）。
- 同步脚本：`python sync_cube_to_supabase.py`（需配置 `.env` 中的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`）。

## Cube → Supabase 同步

- **本地/定时**：运行 `python sync_cube_to_supabase.py`，逻辑保持不变。
- **HTTP 接口**：部署 Edge Function `sync-cube-to-supabase` 后，可通过 API 触发或查询状态：
  - **GET** `https://<project>.supabase.co/functions/v1/sync-cube-to-supabase`  
    返回当前同步游标（`last_analyzed_at`），不执行同步。
  - **POST** `https://<project>.supabase.co/functions/v1/sync-cube-to-supabase`  
    触发一次增量同步。可选查询参数：`?page_size=5000&max_rows=10000` 覆盖环境变量。
  - 请求头需带 `Authorization: Bearer <anon_key>` 或 `Bearer <service_role_key>`。

## 定时任务（每分钟调用一次 Edge Function）

使用 Supabase 的 **pg_cron** + **pg_net**，每分钟 POST 一次 `sync-cube-to-supabase`。

1. **执行迁移**：在项目 `fxllicysqmrtnpxjvldv` 中执行 `supabase/migrations/002_cron_sync_cube.sql`（或 `supabase db push`）。
2. **配置 Vault**：在 Supabase Dashboard → SQL Editor 中执行一次（将 `YOUR_ANON_KEY` 换成项目 Settings → API 里的 anon key）：
   ```sql
   select vault.create_secret('YOUR_ANON_KEY', 'anon_key');
   ```
3. 之后 cron 会每分钟自动调用 Edge Function；可在 Dashboard → Database → Cron Jobs 查看。

### 定时任务没请求到 Edge Function 时怎么排查

在 **SQL Editor** 里按顺序跑下面几段，看是哪一环断了。

**1）cron 任务有没有被登记**

```sql
select jobid, jobname, schedule, command from cron.job where jobname = 'sync-cube-to-supabase-every-minute';
```

- 有 1 行：任务已登记，`schedule` 应为 `* * * * *`（每分钟）。
- 无行：任务没建好，需要重新执行迁移里的 `cron.schedule(...)`。

**2）cron 最近有没有真的在跑**

```sql
select jobid, runid, job_pid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'sync-cube-to-supabase-every-minute')
order by start_time desc
limit 10;
```

- 有最近 1～2 分钟的 `start_time`，且 `status = 'succeeded'`：cron 在跑。
- `status = 'failed'` 或 `return_message` 有内容：看报错（例如没权限、vault 取不到等）。
- 完全没有行或时间很旧：pg_cron 没在执行这条任务（扩展未启用、任务被删等）。

**3）Vault 里有没有 anon_key**

```sql
select name from vault.secrets where name = 'anon_key';
```

- 有 1 行：说明创建过 `anon_key`（看不到内容正常）。
- 无行：**请求会发出去但 Authorization 为空，Edge Function 会 401**。需要在项目里执行一次：
  `select vault.create_secret('你的 anon key', 'anon_key');`

**4）pg_net 有没有发出请求、返回什么**

```sql
select id, status_code, error_msg, created
from net._http_response
order by created desc
limit 10;
```

- 有最近几分钟的 `created`，且 `status_code = 200`：请求已打到 Edge Function 并成功。
- `status_code = 401`：多半是 Vault 里没配好 `anon_key` 或配错。
- `status_code` 为其他或 `error_msg` 有内容：看具体错误（超时、URL 错等）。
- 完全没有最近几行的记录：要么 cron 没跑（回到 1、2），要么 pg_net 没在发请求（扩展、权限或 cron 里 `net.http_post` 报错）。

**常见原因小结**

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| cron.job 无该任务 | 迁移没跑完或只跑了部分 | 再执行一次 `cron.schedule(...)` |
| job_run_details 无/失败 | pg_cron 未启用或任务执行报错 | 开扩展、看 return_message |
| vault 无 anon_key | 没配或配错 | vault.create_secret('anon_key', 真实 key) |
| _http_response 401 | Authorization 无效 | 同上，保证 key 正确 |
| _http_response 无近期记录 | cron 未跑或 net 未发请求 | 先确认 1、2 再查扩展/权限 |

## 阿里云图搜入图（阶段二）

消费 `aliyun_sync_tasks` 中 `status=pending` 的任务，按 **5 QPS** 调用 Hasura AddImage 入图。

- **Edge Function**：`consume-aliyun-sync-tasks`
  - **GET**：返回当前 pending 数量，不执行消费。
  - **POST**：拉取一批 pending 任务，按 5 QPS 调 AddImage，更新 status（synced/failed）、retry_count、error_message。
- **Secrets**（在 Dashboard → Edge Functions → consume-aliyun-sync-tasks → Secrets）：
  - **HASURA_API_TOKEN**（必填）：Hasura worker 的 Bearer token（见 `从cube同步数据到阿里云图搜服务库中.md`；也支持 HASURA_ACCESS_TOKEN）。
  - **ALIYUN_GRAPHQL_URL**（可选）：默认 `https://hasura-auth-worker.data-d1a.workers.dev/`。
  - **INSTANCE_NAME**（可选）：默认 `muse`。
  - **BATCH_SIZE**（可选）：单次最多处理条数，默认 25。
- **定时任务**：执行 `supabase/migrations/003_cron_consume_aliyun.sql` 后，每分钟会 POST 一次该 Edge Function（与 sync-cube 共用 Vault `anon_key`）。

部署阶段二：

1. 部署 Edge Function：`supabase functions deploy consume-aliyun-sync-tasks --project-ref fxllicysqmrtnpxjvldv --workdir .`
2. 在 Dashboard 中为该函数配置 **HASURA_API_TOKEN**（必填）。
3. 在 SQL Editor 中执行 `003_cron_consume_aliyun.sql`（若 002 已跑过，只需执行其中的 `cron.schedule(...)` 即可）。

## Edge Function 日志（含 pg_cron 触发的请求）

由 **pg_cron + pg_net** 触发的请求，console 日志可能不会出现在「Edge Functions → 某函数 → Logs」里，需要到左侧 **Logs** 入口查看：
- 打开 **Logs**（或 **Logs Explorer**）→ 在 **Sources** 里选 **function_logs**（Function internal logs，即 console 输出）。
- 在筛选/搜索里用 `sync-cube` 或 `sync-cube invoked` 过滤。
- 请求/响应元数据在 **function_edge_logs** 里。
