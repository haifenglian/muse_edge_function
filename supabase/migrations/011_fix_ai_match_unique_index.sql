-- 修复 ai_match 表的唯一索引，支持同一商品的多张裁剪图分别匹配
--
-- 问题：当前索引 (source_table, source_id, standard_product_id) 导致
--      同一商品的多张图匹配到同一产品时冲突
--
-- 解决：改为 (source_table, source_id, image_index)，确保同一张图只匹配一次
--      但允许不同图匹配到相同或不同的产品

-- 删除旧的唯一索引
drop index IF exists public.idx_ai_match_unique;

-- 创建新的唯一索引：同一张裁剪图只能匹配到一个标准产品
create unique INDEX IF not exists idx_ai_match_unique
on public.ai_match using btree (source_table, source_id, image_index)
where standard_product_id is not null;  -- 只对已匹配的记录建立唯一约束

COMMENT ON INDEX public.idx_ai_match_unique IS '确保同一张裁剪图（image_index）只匹配到一个标准产品；允许不同图匹配到相同或不同产品';
