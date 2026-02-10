-- Add category_id column to aliyun_sync_tasks table
-- category_id comes from dws_standard_products_tag_view.category_id

ALTER TABLE public.aliyun_sync_tasks
ADD COLUMN IF NOT EXISTS category_id integer;

COMMENT ON COLUMN public.aliyun_sync_tasks.category_id IS '品类ID，来自 dws_standard_products_tag_view.category_id';
