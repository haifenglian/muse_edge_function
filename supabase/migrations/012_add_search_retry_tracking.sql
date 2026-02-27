-- ai_match 表增加图搜重试追踪字段
-- 用于记录重试次数和失败原因，达到上限后不再重试

-- 重试次数字段
ALTER TABLE public.ai_match
ADD COLUMN IF NOT EXISTS search_retry_count integer DEFAULT 0;

-- 最近一次图搜失败的错误信息
ALTER TABLE public.ai_match
ADD COLUMN IF NOT EXISTS search_error_message text;

-- 注释
COMMENT ON COLUMN public.ai_match.search_retry_count IS '图搜重试次数，达到 MAX_RETRIES 后不再重试';
COMMENT ON COLUMN public.ai_match.search_error_message IS '最近一次图搜失败的错误信息；no match 时清空';

-- 索引（可选，用于查询待重试记录）
CREATE INDEX IF NOT EXISTS idx_ai_match_search_retry_count
ON public.ai_match (search_retry_count)
WHERE search_retry_count < 10;
