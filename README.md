# muse_edge_function

muse 的后端服务。

## 环境

- **Python**：3.11 / 3.12 / 3.14 均可（同步脚本用 requests 直连 Supabase REST API，不依赖 supabase/httpx）。
- 同步脚本：`python sync_cube_to_supabase.py`（需配置 `.env` 中的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`）。
