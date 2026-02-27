-- 为 ai_match 表添加真正的 UNIQUE CONSTRAINT（替换现有的 UNIQUE INDEX）
-- 这样 Supabase 的 upsert 才能正确工作

-- 先删除现有的 UNIQUE INDEX
DROP INDEX IF EXISTS public.idx_ai_match_unique;

-- 创建真正的 UNIQUE CONSTRAINT（会自动创建索引）
ALTER TABLE public.ai_match
ADD CONSTRAINT ai_match_unique_constraint
UNIQUE (source_table, source_id, image_index, detection_index);

COMMENT ON CONSTRAINT ai_match_unique_constraint ON public.ai_match IS '确保同一检测主体（source_table + source_id + image_index + detection_index）只有一条记录';
