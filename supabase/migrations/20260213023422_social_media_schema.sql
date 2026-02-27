-- 社媒主体识别任务表：Cube dwd_social_media_data_view 同步后的中间表
-- 一行对应一张图，冗余社媒信息，供主体识别消费

CREATE TABLE IF NOT EXISTS public.social_media_subject_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  source_name text,
  image_url text NOT NULL,
  position integer NOT NULL,
  origin_url text,
  platform text,
  account_type text,
  author_account text,
  text_content text,
  source_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  crop_image text,
  category_id text,
  error_message text,
  publish_time timestamptz,
  fetch_time timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (source_id, position)
);

CREATE INDEX IF NOT EXISTS idx_social_media_subject_tasks_status ON public.social_media_subject_tasks (status);
CREATE INDEX IF NOT EXISTS idx_social_media_subject_tasks_source_id ON public.social_media_subject_tasks (source_id);
CREATE INDEX IF NOT EXISTS idx_social_media_subject_tasks_platform ON public.social_media_subject_tasks (platform);

COMMENT ON TABLE public.social_media_subject_tasks IS '社媒图片主体识别任务，来源 Cube dwd_social_media_data_view，按图粒度';
COMMENT ON COLUMN public.social_media_subject_tasks.source_id IS '社媒内容唯一标识';
COMMENT ON COLUMN public.social_media_subject_tasks.image_url IS 'stored_url，转存后的图片 URL';
COMMENT ON COLUMN public.social_media_subject_tasks.position IS '图片序号，对应 ai_match.image_index';
COMMENT ON COLUMN public.social_media_subject_tasks.platform IS '社媒平台（如 instagram, tiktok 等）';
COMMENT ON COLUMN public.social_media_subject_tasks.account_type IS '账号类型';
COMMENT ON COLUMN public.social_media_subject_tasks.author_account IS '作者账号';
COMMENT ON COLUMN public.social_media_subject_tasks.text_content IS '文本内容';
COMMENT ON COLUMN public.social_media_subject_tasks.origin_url IS '原始图片 URL';
COMMENT ON COLUMN public.social_media_subject_tasks.source_url IS '内容来源链接';
