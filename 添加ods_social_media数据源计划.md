# 添加 ods_social_media 数据源支持

## 背景

当前已实现电商数据（`ods_ecommerce`）的完整流程：
- Cube (`dwd_ecommerce_products_view`) → `ecommerce_subject_tasks` → 主体识别 → `ai_match` → 图搜

现在需要以相同方式支持社媒数据（`ods_social_media`）。

---

## 方案选择：简单复制

用户选择快速实现方案，直接复制电商的 Edge Function 和任务表，修改社媒特定的硬编码值。

---

## 关键差异对比

| 维度 | 电商 (ecommerce) | 社媒 (social_media) |
|------|------------------|---------------------|
| **Cube View** | `dwd_ecommerce_products_view` | `ods_social_media_view` (需确认) |
| **主键字段** | `product_id` | `id` |
| **名称字段** | `product_name` | `source_name` |
| **图片字段** | `stored_url` (单张) | `resaved_image_path` (数组) |
| **图片序号** | `position` | 数组索引 |
| **游标字段** | `updated_at` | `fetch_time` |
| **游标键** | `cube_ecommerce_last_updated_at` | `cube_social_media_last_fetch_time` |
| **source_table** | `ods_ecommerce` | `ods_social_media` |

**注意**：社媒的 `resaved_image_path` 是 `ARRAY<STRING>`，需要展开为数组元素，每张图创建一条任务记录。

---

## 实现步骤

### 1. 创建社媒任务表

**文件**: `supabase/migrations/009_social_media_schema.sql`

```sql
-- 社媒主体识别任务表
CREATE TABLE IF NOT EXISTS public.social_media_subject_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,              -- 对应 ods_social_media.id
  source_name text,                     -- 对应 ods_social_media.source_name
  image_url text NOT NULL,              -- resaved_image_path 数组中的单个 URL
  image_index integer NOT NULL,         -- 图片在数组中的索引
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  crop_image text,                      -- 主体识别返回的 GCS URL
  category_id text,                     -- 主体识别返回的品类编号
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (source_id, image_index)
);

CREATE INDEX IF NOT EXISTS idx_social_media_subject_tasks_status ON public.social_media_subject_tasks (status);
CREATE INDEX IF NOT EXISTS idx_social_media_subject_tasks_source_id ON public.social_media_subject_tasks (source_id);

COMMENT ON TABLE public.social_media_subject_tasks IS '社媒图片主体识别任务，来源 Cube ods_social_media_view';
COMMENT ON COLUMN public.social_media_subject_tasks.image_url IS 'resaved_image_path 数组中的单个图片 URL';
COMMENT ON COLUMN public.social_media_subject_tasks.image_index IS '图片在 resaved_image_path 数组中的索引';
```

---

### 2. 创建社媒同步函数

**文件**: `supabase/functions/sync-social-media-cube-to-supabase/index.ts`

**参考**: `supabase/functions/sync-ecommerce-cube-to-supabase/index.ts`

**关键修改**：
- `CUBE_VIEW = "ods_social_media_view"`
- `cursorKey = "cube_social_media_last_fetch_time"`
- `tasksTable = "social_media_subject_tasks"`
- `onConflict = "source_id,image_index"`
- `timestampField = "fetch_time"`
- **展开 `resaved_image_path` 数组**：每张图创建一条任务记录

```typescript
// Cube 查询维度
const VIEW_DIMENSIONS = [
  `ods_social_media_view.id`,
  `ods_social_media_view.source_name`,
  `ods_social_media_view.resaved_image_path`,
  `ods_social_media_view.fetch_time`,
];

// 过滤条件
filters: [
  { member: `ods_social_media_view.resaved_image_path`, operator: "set" },
  { member: `ods_social_media_view.fetch_time`, operator: "gt", values: [sinceUpdatedAt] },
],

// 行转任务：展开图片数组
function rowToTask(row: Record<string, unknown>): Array<Record<string, unknown>> {
  const sourceId = get(row, "id");
  const sourceName = get(row, "source_name");
  const imagePath = get(row, "resaved_image_path"); // ARRAY<STRING>

  if (!sourceId || !imagePath) return [];

  const urls = Array.isArray(imagePath) ? imagePath : [imagePath];
  const tasks: Array<Record<string, unknown>> = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (url && typeof url === "string" && url.trim()) {
      tasks.push({
        source_id: String(sourceId),
        source_name: sourceName != null ? String(sourceName) : null,
        image_url: url.trim(),
        image_index: i,
        status: "pending",
      });
    }
  }

  return tasks;
}

// Upsert
await supabase.from("social_media_subject_tasks").upsert(tasks, {
  onConflict: "source_id,image_index",
  ignoreDuplicates: true,
});
```

---

### 3. 创建社媒主体识别消费函数

**文件**: `supabase/functions/consume-social-media-subject-tasks/index.ts`

**参考**: `supabase/functions/consume-ecommerce-subject-tasks/index.ts`

**关键修改**：
- `SOURCE_TABLE = "ods_social_media"`
- `tasksTable = "social_media_subject_tasks"`
- 字段映射：`source_id` (非 `product_id`)，`image_index` (非 `position`)

```typescript
const SOURCE_TABLE = "ods_social_media";

// 拉取 pending 任务
const { data: tasks } = await supabase
  .from("social_media_subject_tasks")
  .select("*")
  .eq("status", "pending")
  .limit(batchSize);

// 提取字段
const sourceId = task.source_id;
const sourceName = task.source_name;
const imageUrl = task.image_url;
const imageIndex = task.image_index;

// 写入 ai_match
const aiMatchData = {
  crop_image: gcsUrl,
  category_id: category,
  standard_product_id: null,
  confidence: 0,
  source_table: SOURCE_TABLE,
  source_id: sourceId,           // 注意：不是 product_id
  source_name: sourceName,       // 注意：不是 product_name
  image_index: imageIndex,       // 注意：不是 position
};

// Upsert 条件
.eq("source_table", SOURCE_TABLE)
.eq("source_id", sourceId)
.eq("image_index", imageIndex);
```

---

### 4. 创建定时任务

**文件**: `supabase/migrations/010_cron_social_media.sql`

```sql
-- 定时任务：每分钟调用 sync-social-media-cube-to-supabase
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

-- 定时任务：每分钟调用 consume-social-media-subject-tasks
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
```

---

## 执行顺序

1. **创建数据库表** (Migration 009)
2. **创建同步函数** (Edge Function)
3. **创建消费函数** (Edge Function)
4. **创建定时任务** (Migration 010)

---

## 验证步骤

### 1. 手动测试同步函数

```bash
# 触发一次同步
curl -X POST "https://fxllicysqmrtnpxjvldv.supabase.co/functions/v1/sync-social-media-cube-to-supabase" \
  -H "Authorization: Bearer <ANON_KEY>"

# 查询任务表
SELECT COUNT(*), status FROM social_media_subject_tasks GROUP BY status;
```

### 2. 手动测试消费函数

```bash
# 触发一次主体识别
curl -X POST "https://fxllicysqmrtnpxjvldv.supabase.co/functions/v1/consume-social-media-subject-tasks" \
  -H "Authorization: Bearer <ANON_KEY>"

# 查询 ai_match
SELECT COUNT(*), source_table FROM ai_match GROUP BY source_table;
```

### 3. 等待定时任务自动运行

查看 cron 日志确认任务正常执行。

---

## 待确认事项

| 问题 | 说明 |
|------|------|
| **Cube View 名称** | `ods_social_media_view` 是否已在 Cube 侧创建？ |
| **图片数组结构** | `resaved_image_path` 是 `ARRAY<STRING>` 吗？有无空元素？ |
| **游标初始值** | 首次运行是否只拉最近 N 天数据？ |

---

## 文件清单

| 操作 | 文件路径 |
|------|----------|
| 新增 | `supabase/migrations/009_social_media_schema.sql` |
| 新增 | `supabase/functions/sync-social-media-cube-to-supabase/index.ts` |
| 新增 | `supabase/functions/consume-social-media-subject-tasks/index.ts` |
| 新增 | `supabase/migrations/010_cron_social_media.sql` |

---

## 工作量估算

- 创建 migration 文件：0.5 小时
- 复制并修改同步函数：1 小时
- 复制并修改消费函数：1 小时
- 测试验证：1 小时

**合计**：约 3.5 小时
