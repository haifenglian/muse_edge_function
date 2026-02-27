-- 添加 detection_index 字段支持同一图片的多主体检测
-- 社媒数据可能从一张图片中检测到多个主体（如包、鞋、配饰等）
-- 每个主体生成一条 ai_match 记录，使用 detection_index 区分

-- 添加 detection_index 字段
ALTER TABLE public.ai_match
ADD COLUMN IF NOT EXISTS detection_index integer DEFAULT 0;

COMMENT ON COLUMN public.ai_match.detection_index IS '同一图片中检测到的主体序号，0 表示第一个主体，支持多目标检测';

-- 更新唯一索引：将 detection_index 纳入唯一约束
-- 先删除旧的索引
DROP INDEX IF EXISTS public.idx_ai_match_unique;

-- 创建新的唯一索引：同一张裁剪图（source_id + image_index + detection_index）只能匹配到一个标准产品
CREATE UNIQUE INDEX idx_ai_match_unique
ON public.ai_match (source_table, source_id, image_index, detection_index)
WHERE standard_product_id IS NOT NULL;

COMMENT ON INDEX public.idx_ai_match_unique IS '确保同一检测主体（image_index + detection_index）只匹配到一个标准产品；允许不同主体匹配到相同或不同产品';
