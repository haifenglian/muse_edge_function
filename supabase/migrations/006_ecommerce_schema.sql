-- 电商主体识别任务表：Cube dwd_ecommerce_products_view 同步后的中间表
-- 一行对应一张图（stored_url），冗余商品信息，供主体识别消费

CREATE TABLE IF NOT EXISTS public.ecommerce_subject_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  product_name text,
  image_url text NOT NULL,
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  crop_image text,
  category_id text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, position)
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_subject_tasks_status ON public.ecommerce_subject_tasks (status);
CREATE INDEX IF NOT EXISTS idx_ecommerce_subject_tasks_product_id ON public.ecommerce_subject_tasks (product_id);

COMMENT ON TABLE public.ecommerce_subject_tasks IS '电商图片主体识别任务，来源 Cube dwd_ecommerce_products_view，按图粒度';
COMMENT ON COLUMN public.ecommerce_subject_tasks.image_url IS 'stored_url，转存后的图片 URL';
COMMENT ON COLUMN public.ecommerce_subject_tasks.position IS '图片序号，对应 ai_match.image_index';
