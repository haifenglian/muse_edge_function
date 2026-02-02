-- ai_match 增加 last_search_at：no match 时更新，拉取时「未搜过或距上次搜超过 1 小时」才再试，避免同一行一直 no match 被每分钟重试

ALTER TABLE public.ai_match
  ADD COLUMN IF NOT EXISTS last_search_at timestamptz NULL;

COMMENT ON COLUMN public.ai_match.last_search_at IS '最近一次图搜时间；no match 时更新，用于限制重试频率（如 1 小时内不再拉取）';
