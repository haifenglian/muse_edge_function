"""
阶段一：从 Cube dws_standard_products_tag_view 增量拉取数据，
写入 Supabase 产品表，并按 resaved_image_path 展开写入阿里云同步任务表。

增量逻辑：从 sync_state 表读取上次同步的 last_ingested_at，只拉 ingested_at > last_ingested_at；
首次运行无游标时做全量拉取，拉完后写入本批 max(ingested_at) 到 sync_state。

环境变量：
  SUPABASE_URL          Supabase 项目 URL
  SUPABASE_SERVICE_ROLE_KEY  或 SUPABASE_KEY  Service role key（可写表）
  CUBE_BASE_URL         Cube API base URL（可选，有默认）
  CUBE_API_SECRET       Cube API secret（可选，有默认）
  CUBE_PAGE_SIZE        每页条数（默认 5000）
  CUBE_MAX_ROWS         单次最多拉取条数（可选，不设则拉完本批增量）
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List

import requests

from fetch_cube_data import (
    CubeAPIError,
    CubeClient,
    CubeConfig,
    fetch_view_incremental,
)

JsonDict = Dict[str, Any]
PREFIX = "dws_standard_products_tag_view."


def _supabase_rest(
    base_url: str,
    key: str,
    *,
    method: str = "GET",
    path: str = "",
    params: Dict[str, str] | None = None,
    json_body: List[Dict] | Dict | None = None,
    prefer: str = "",
) -> List[Dict]:
    """用 requests 调 Supabase PostgREST，兼容 Python 3.14（不依赖 supabase/httpx）。"""
    url = f"{base_url.rstrip('/')}/rest/v1/{path.lstrip('/')}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    kwargs = {"timeout": 60, "params": params}
    if method != "GET" and json_body is not None:
        kwargs["json"] = json_body
    resp = requests.request(method, url, headers=headers, **kwargs)
    if not resp.ok:
        try:
            err = resp.json()
        except Exception:
            err = resp.text
        raise requests.HTTPError(f"{resp.status_code} {resp.reason}: {err}", response=resp)
    if not resp.content:
        return []
    out = resp.json()
    return out if isinstance(out, list) else [out]


def _get(row: JsonDict, key: str) -> Any:
    """从 Cube 返回行中取值，支持带前缀的 key。"""
    v = row.get(PREFIX + key) or row.get(key)
    return v


def _parse_resaved_image_path(v: Any) -> List[str]:
    """将 resaved_image_path 转为 URL 字符串列表。"""
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v]
    if isinstance(v, str):
        try:
            arr = json.loads(v)
            return [str(x) for x in arr] if isinstance(arr, list) else []
        except (json.JSONDecodeError, TypeError):
            return []
    return []


def _row_to_product(row: JsonDict) -> JsonDict:
    """将 Cube 返回的一行转为产品表一行（列名无前缀），dimensions_str 不允许 null。"""
    raw_id = _get(row, "id")
    resaved = _get(row, "resaved_image_path")
    raw_cat = _get(row, "category_id")
    if raw_cat is not None and isinstance(raw_cat, (int, float)) and not math.isnan(raw_cat):
        category_id = int(raw_cat)
    else:
        category_id = None
    dims_str = _get(row, "dimensions_str")
    if dims_str is None:
        dimensions_str_value = "{}"
    elif isinstance(dims_str, str):
        dimensions_str_value = dims_str
    else:
        dimensions_str_value = json.dumps(dims_str)
    return {
        "id": str(raw_id) if raw_id is not None else None,
        "category_id": category_id,
        "dimensions_str": dimensions_str_value,
        "category_tagged_time": _get(row, "category_tagged_time"),
        "dimensions_tagged_time": _get(row, "dimensions_tagged_time"),
        "ingested_at": _get(row, "ingested_at"),
        "resaved_image_path": _parse_resaved_image_path(resaved) if resaved is not None else [],
    }


def _expand_tasks(product_id: str, dimensions_str: Any, resaved_image_path: List[str]) -> List[JsonDict]:
    """按图展开为任务表多行。picName = {id}_0, {id}_1, ..."""
    tasks = []
    for i, url in enumerate(resaved_image_path):
        if not url or not url.strip():
            continue
        tasks.append({
            "product_id": product_id,
            "pic_url": url.strip(),
            "pic_name": f"{product_id}_{i}",
            "custom_content": dimensions_str if isinstance(dimensions_str, str) else (json.dumps(dimensions_str) if dimensions_str is not None else None),
            "status": "pending",
        })
    return tasks


def run_sync(
    *,
    page_size: int = 5000,
    max_rows: int | None = None,
    batch_size: int = 200,
) -> None:
    supabase_url = os.environ.get("SUPABASE_URL", "https://fxllicysqmrtnpxjvldv.supabase.co").strip()
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY","eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4bGxpY3lzcW1ydG5weGp2bGR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2NDcxNjgsImV4cCI6MjA4MDIyMzE2OH0.rN_UAzM6Rlb6CGkpY64N6tO_hm1lwpfusvMSv91wVWc") or os.environ.get("SUPABASE_KEY", "").strip()
    if not supabase_url or not supabase_key:
        print("请设置环境变量 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY（或 SUPABASE_KEY）", file=sys.stderr)
        sys.exit(1)

    cube_base = os.environ.get("CUBE_BASE_URL", "https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1")
    cube_secret = os.environ.get("CUBE_API_SECRET", "032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061")

    cfg = CubeConfig(base_url=cube_base, api_secret=cube_secret, token_ttl_seconds=3600, timeout_seconds=60)
    client = CubeClient(cfg)

    cursor_key = "cube_last_ingested_at"
    try:
        data = _supabase_rest(
            supabase_url,
            supabase_key,
            method="GET",
            path="sync_state",
            params={"key": f"eq.{cursor_key}", "select": "value"},
            prefer="return=representation",
        )
        last_ingested_at = data[0]["value"] if data else None
    except Exception:
        last_ingested_at = None
    if last_ingested_at:
        print(f"增量同步：ingested_at > {last_ingested_at}")
    else:
        print("首次同步（全量）")

    print("从 Cube dws_standard_products_tag_view 拉取数据...")
    try:
        rows = fetch_view_incremental(
            client,
            since_ingested_at=last_ingested_at,
            page_size=page_size,
            max_rows=max_rows,
        )
    except CubeAPIError as e:
        print(f"Cube 拉取失败: {e}", file=sys.stderr)
        sys.exit(1)

    if not rows:
        print("本批无新数据，结束")
        return

    print(f"本批 {len(rows)} 条，写入产品表并展开任务表...")

    products = []
    all_tasks: List[JsonDict] = []
    for row in rows:
        raw_id = _get(row, "id")
        if raw_id is None:
            continue
        product_id = str(raw_id)
        product = _row_to_product(row)
        products.append(product)
        resaved = _parse_resaved_image_path(_get(row, "resaved_image_path"))
        if not resaved:
            resaved = [f"https://example.com/placeholder/{product_id}.jpg"]
        dims_str = _get(row, "dimensions_str")
        if dims_str is None:
            dims_str = "{}"
        all_tasks.extend(_expand_tasks(product_id, dims_str, resaved))

    for i in range(0, len(products), batch_size):
        batch = products[i : i + batch_size]
        _supabase_rest(
            supabase_url,
            supabase_key,
            method="POST",
            path="standard_products_tag",
            json_body=batch,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        print(f"  产品表 upsert {i + 1}..{i + len(batch)}")

    inserted = 0
    for t in all_tasks:
        try:
            _supabase_rest(
                supabase_url,
                supabase_key,
                method="POST",
                path="aliyun_sync_tasks",
                json_body=t,
                prefer="return=minimal",
            )
            inserted += 1
        except requests.HTTPError as e:
            if e.response.status_code == 409 or "23505" in (e.response.text or ""):
                pass
            else:
                print(f"  任务插入失败 {t.get('product_id')} {t.get('pic_name')}: {e}", file=sys.stderr)
        except Exception as e:
            if "duplicate" in str(e).lower() or "unique" in str(e).lower() or "23505" in str(e):
                pass
            else:
                print(f"  任务插入失败 {t.get('product_id')} {t.get('pic_name')}: {e}", file=sys.stderr)

    ingested_values = [_get(row, "ingested_at") for row in rows]
    ingested_values = [v for v in ingested_values if v is not None]
    new_cursor = max(ingested_values) if ingested_values else last_ingested_at
    if new_cursor:
        _supabase_rest(
            supabase_url,
            supabase_key,
            method="POST",
            path="sync_state",
            json_body={"key": cursor_key, "value": new_cursor, "updated_at": datetime.now(tz=timezone.utc).isoformat()},
            prefer="resolution=merge-duplicates,return=minimal",
        )
        print(f"游标已更新: cube_last_ingested_at = {new_cursor}")

    print(f"产品表: {len(products)} 条; 任务表: 新增 {inserted} 条（共 {len(all_tasks)} 条待处理）")
    print("阶段一完成。")


def main() -> None:
    page_size = int(os.environ.get("CUBE_PAGE_SIZE", "5000"))
    max_rows_env = os.environ.get("CUBE_MAX_ROWS", "").strip()
    max_rows = int(max_rows_env) if max_rows_env else None
    run_sync(page_size=page_size, max_rows=max_rows)


if __name__ == "__main__":
    main()
