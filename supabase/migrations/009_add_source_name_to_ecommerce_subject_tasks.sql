-- Add source_id and source_name columns to ecommerce_subject_tasks table
-- source_id comes from dwd_ecommerce_products_view.id
-- source_name comes from dwd_ecommerce_products_view.source_name (e.g., "淘宝", "京东")

ALTER TABLE public.ecommerce_subject_tasks
ADD COLUMN IF NOT EXISTS source_id text,
ADD COLUMN IF NOT EXISTS source_name text;

COMMENT ON COLUMN public.ecommerce_subject_tasks.source_id IS 'Cube 原始记录 ID，来自 dwd_ecommerce_products_view.id';
COMMENT ON COLUMN public.ecommerce_subject_tasks.source_name IS '来源平台名称，来自 dwd_ecommerce_products_view.source_name';
