# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

muse 的后端服务，负责编排从 Cube Analytics 到 Supabase 再到阿里云图搜的数据管道。系统处理商品图片同步、AI 驱动的主体识别/裁剪以及图像搜索匹配。

## 架构

### 数据流管道

1. **阶段一 - Cube 到 Supabase 同步**
   - 从 Cube 的 `dws_standard_products_tag_view` 增量拉取数据
   - 写入 Supabase 的 `standard_products_tag` 表
   - 按图片粒度在 `aliyun_sync_tasks` 表中创建任务
   - 使用 `analyzed_at` 时间戳在 `sync_state` 表中跟踪同步游标

2. **阶段二 - 阿里云图搜入图**
   - 消费 `aliyun_sync_tasks` 中 `status='pending'` 的任务
   - 调用 Hasura GraphQL 端点将图片添加到阿里云图搜（5 QPS 限制）
   - 更新任务状态为 `synced`/`failed`，支持重试逻辑

3. **电商流程**
   - 从 Cube 的 `dwd_ecommerce_products_view` 同步到 `ecommerce_subject_tasks`
   - 通过 OpenRouter (google/gemini-flash-preview) 执行 AI 主体识别
   - 裁剪图片以提取主体（包、鞋、配饰、服装）
   - 支持针对不同品类的识别逻辑

4. **AI 图像匹配**
   - 使用阿里云图搜 API 搜索相似图片
   - 返回带评分的匹配结果用于商品发现

### 组件结构

- **Python 脚本**（根目录）：用于本地/定时执行的独立同步/处理脚本
  - `fetch_cube_data.py`：Cube API 客户端，支持 JWT 认证、分页、重试逻辑
  - `sync_cube_to_supabase.py`：阶段一同步实现
  - `subject_detection_crop.py`：AI 驱动的图像主体识别/裁剪

- **Supabase Edge Functions** (`supabase/functions/`)：Deno/TypeScript 无服务器函数
  - `sync-cube-to-supabase`：阶段一同步的 HTTP 包装器
  - `consume-aliyun-sync-tasks`：阶段二消费者（5 QPS 限流）
  - `sync-ecommerce-cube-to-supabase`：电商产品同步
  - `consume-ecommerce-subject-tasks`：电商主体识别处理器
  - `search-image-ai-match`：图像相似度搜索端点

- **数据库迁移** (`supabase/migrations/`)：Schema 和 cron 任务定义
  - `001_schema.sql`：核心表（standard_products_tag, aliyun_sync_tasks, sync_state）
  - `006_ecommerce_schema.sql`：电商主体识别表
  - `002-004_cron_*.sql`：每分钟 POST 调用 Edge Functions 的 pg_cron 任务
  - `008_cron_ecommerce.sql`：电商处理 cron

### 通过 pg_cron 实现自动化

系统使用 PostgreSQL 的 pg_cron + pg_net 扩展每分钟触发 Edge Functions：
- Cron 任务在迁移文件中定义
- 任务使用 `net.http_post()` 调用 Edge Functions
- 通过 Vault secret `anon_key` 进行授权
- 日志在 Supabase Dashboard → Logs → function_logs 中可见

## 开发命令

### Python 环境设置
```bash
# 安装依赖（Python 3.11/3.12/3.14）
pip install -r requirements.txt

# 配置环境变量（必需：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY）
# 编辑 .env 文件填入你的凭据
```

### 本地 Python 脚本
```bash
# 阶段一：从 Cube 同步到 Supabase（增量）
python sync_cube_to_supabase.py

# 拉取 Cube 数据（库用法 - 查看脚本了解 API）
python fetch_cube_data.py

# 主体识别和裁剪（需要图片输入）
python subject_detection_crop.py --input <image_path> --category <3|4|5|88888888>
```

### Supabase CLI 命令

假设已安装 Supabase CLI 且项目已链接到 `fxllicysqmrtnpxjvldv`。

```bash
# 应用数据库迁移
supabase db push

# 部署特定 Edge Function
supabase functions deploy <function-name> --project-ref fxllicysqmrtnpxjvldv --workdir .

# 部署所有 Edge Functions
supabase functions deploy --project-ref fxllicysqmrtnpxjvldv --workdir .

# 查看 Edge Function 日志（或在 Dashboard → Logs → function_logs）
supabase functions logs <function-name> --project-ref fxllicysqmrtnpxjvldv
```

### 本地测试 Edge Functions
```bash
# 测试 sync-cube-to-supabase（GET - 状态检查）
curl https://<project>.supabase.co/functions/v1/sync-cube-to-supabase \
  -H "Authorization: Bearer <anon_key>"

# 触发同步（POST）
curl -X POST https://<project>.supabase.co/functions/v1/sync-cube-to-supabase \
  -H "Authorization: Bearer <anon_key>"

# 通过查询参数覆盖 page size/max rows
curl -X POST "https://<project>.supabase.co/functions/v1/sync-cube-to-supabase?page_size=1000&max_rows=5000" \
  -H "Authorization: Bearer <anon_key>"
```

### 调试 Cron 任务

如果 cron 任务没有触发 Edge Functions，在 Supabase Dashboard → SQL Editor 中运行以下 SQL 查询：

```sql
-- 1. 验证 cron 任务已注册
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname = 'sync-cube-to-supabase-every-minute';

-- 2. 检查最近的 cron 执行
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sync-cube-to-supabase-every-minute')
ORDER BY start_time DESC LIMIT 10;

-- 3. 验证 Vault secret 存在
SELECT name FROM vault.secrets WHERE name = 'anon_key';

-- 4. 检查 pg_net HTTP 响应
SELECT id, status_code, error_msg, created
FROM net._http_response
ORDER BY created DESC LIMIT 10;
```

## 关键配置

### 环境变量（Python 脚本）
- `SUPABASE_URL`：Supabase 项目 URL
- `SUPABASE_SERVICE_ROLE_KEY` 或 `SUPABASE_KEY`：Service role key（用于写入权限）
- `CUBE_BASE_URL`：Cube API base URL（有默认值）
- `CUBE_API_SECRET`：Cube API secret（有默认值）
- `CUBE_PAGE_SIZE`：分页大小（默认：5000）
- `CUBE_MAX_ROWS`：单次同步最大行数（可选）

### Edge Function Secrets（在 Dashboard 中配置）
- **consume-aliyun-sync-tasks**：
  - `HASURA_API_TOKEN`（必需）：Hasura worker 的 Bearer token
  - `ALIYUN_GRAPHQL_URL`（可选）：默认为 Hasura worker URL
  - `INSTANCE_NAME`（可选）：默认 "muse"
  - `BATCH_SIZE`（可选）：默认 25

- **sync-cube-to-supabase**：
  - `CUBE_BASE_URL`, `CUBE_API_SECRET`（可选，有默认值）

### Vault Secrets（SQL）
```sql
-- cron 任务向 Edge Functions 认证所需
SELECT vault.create_secret('<your_anon_key>', 'anon_key');
```

## 重要实现细节

### 增量同步逻辑
- 使用 `sync_state` 表跟踪 `last_analyzed_at` 游标
- 仅拉取 `analyzed_at > last_analyzed_at` 的 Cube 行
- 无游标的首次运行执行全量拉取
- 成功同步后将游标更新为 `max(analyzed_at)`

### 限流
- 阿里云同步任务遵守 5 QPS 限制（在 consume-aliyun-sync-tasks 中硬编码）
- 通过 API 调用之间 200ms 延迟实现

### 主体识别类别
数字类别 ID 映射到产品类型：
- `3`：bag（包）
- `4`：shoes（鞋）
- `5`：accessories（配饰）
- `88888888`：clothing（服装）

检测使用归一化坐标（0-1000 范围），格式为 `[ymin, xmin, ymax, xmax]`。

### 错误处理
- 同步任务支持重试逻辑（max_retries 字段，默认 3）
- 失败任务存储 error_message 用于调试
- 状态转换：pending → synced/failed
- 处理时间戳跟踪任务生命周期

## Git 工作流

当前分支：`main`（也是 PR 的主分支）

提交时，遵循最近提交中可见的现有消息风格。
