-- 阶段一：产品表 + 阿里云同步任务表
-- 在 Supabase SQL Editor 中执行，或使用 supabase db push

-- 1. 产品表（承接 Cube dws_standard_products_tag_view 数据）
CREATE TABLE IF NOT EXISTS public.standard_products_tag (
  id text PRIMARY KEY,
  category_id integer,
  dimensions_str text,
  category_tagged_time timestamptz,
  dimensions_tagged_time timestamptz,
  ingested_at timestamptz,
  resaved_image_path jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.standard_products_tag IS 'Cube 同步产品表，来源 dws_standard_products_tag_view';
COMMENT ON COLUMN public.standard_products_tag.resaved_image_path IS '图片 URL 列表，Array<String> 存为 jsonb';

-- 2. 阿里云同步任务表（按图粒度，每张图一条，含入图库日志字段）
CREATE TABLE IF NOT EXISTS public.aliyun_sync_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  pic_url text NOT NULL,
  pic_name text NOT NULL,
  custom_content text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  error_message text,
  processing_started_at timestamptz,
  synced_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, pic_name)
);

CREATE INDEX IF NOT EXISTS idx_aliyun_sync_tasks_status ON public.aliyun_sync_tasks (status);
CREATE INDEX IF NOT EXISTS idx_aliyun_sync_tasks_product_id ON public.aliyun_sync_tasks (product_id);

COMMENT ON TABLE public.aliyun_sync_tasks IS '阿里云图搜入图任务，消费者轮询 status=pending，5 QPS 调 AddImage';
COMMENT ON COLUMN public.aliyun_sync_tasks.max_retries IS '最大重试次数';
COMMENT ON COLUMN public.aliyun_sync_tasks.error_message IS '最近一次失败的错误信息';
COMMENT ON COLUMN public.aliyun_sync_tasks.processing_started_at IS '消费者开始处理该任务的时间';
COMMENT ON COLUMN public.aliyun_sync_tasks.synced_at IS '成功入阿里云图库的时间';
COMMENT ON COLUMN public.aliyun_sync_tasks.completed_at IS '任务结束时间（成功或失败）';

-- 3. 增量同步游标表（存上次同步到的 ingested_at）
CREATE TABLE IF NOT EXISTS public.sync_state (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.sync_state IS '同步游标，key=cube_last_ingested_at 时 value 为上次同步的最大 ingested_at（ISO 字符串）';

-- 可选：updated_at 自动更新
-- CREATE OR REPLACE FUNCTION public.set_updated_at()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.updated_at = now();
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- DROP TRIGGER IF EXISTS set_standard_products_tag_updated_at ON public.standard_products_tag;
-- CREATE TRIGGER set_standard_products_tag_updated_at
--   BEFORE UPDATE ON public.standard_products_tag
--   FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- DROP TRIGGER IF EXISTS set_aliyun_sync_tasks_updated_at ON public.aliyun_sync_tasks;
-- CREATE TRIGGER set_aliyun_sync_tasks_updated_at
--   BEFORE UPDATE ON public.aliyun_sync_tasks
--   FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
