"""
获取 Cube 数据的脚本
查询表: dws_standard_products_tag
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, List

import jwt
import requests
from requests import Response
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

JsonDict = Dict[str, Any]


class CubeAPIError(RuntimeError):
    """Raised when Cube API returns non-2xx response."""

    def __init__(self, status_code: int, message: str, payload: Optional[JsonDict] = None):
        super().__init__(f"Cube API error {status_code}: {message}")
        self.status_code = status_code
        self.payload = payload or {}


@dataclass(frozen=True)
class CubeConfig:
    """
    Cube API 配置
    base_url: https://<your-domain>/cubejs-api/v1
    """
    base_url: str
    api_secret: str
    algorithm: str = "HS256"
    token_ttl_seconds: int = 3600
    timeout_seconds: int = 30
    user_agent: str = "cube-python-client/1.0"


class CubeClient:
    """Cube API 客户端"""

    def __init__(
        self,
        config: CubeConfig,
        *,
        default_security_context: Optional[JsonDict] = None,
        session: Optional[requests.Session] = None,
        retries: int = 3,
        backoff_factor: float = 0.4,
    ) -> None:
        self.config = config
        self.default_security_context = default_security_context or {}

        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": self.config.user_agent})

        # 配置重试机制
        retry = Retry(
            total=retries,
            connect=retries,
            read=retries,
            status=retries,
            backoff_factor=backoff_factor,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET", "POST"),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

    def make_token(
        self,
        *,
        security_context: Optional[JsonDict] = None,
        ttl_seconds: Optional[int] = None,
        extra_claims: Optional[JsonDict] = None,
    ) -> str:
        """
        创建 Cube JWT Token
        """
        now = int(time.time())
        exp = now + int(ttl_seconds or self.config.token_ttl_seconds)

        ctx = dict(self.default_security_context)
        if security_context:
            ctx.update(security_context)

        payload: JsonDict = {
            "iat": now,
            "exp": exp,
            **ctx,
        }
        if extra_claims:
            payload.update(extra_claims)

        token = jwt.encode(payload, self.config.api_secret, algorithm=self.config.algorithm)

        # PyJWT v1 可能返回 bytes; v2 返回 str
        if isinstance(token, bytes):
            token = token.decode("utf-8")
        return token

    def _request(
        self,
        method: str,
        path: str,
        *,
        token: Optional[str] = None,
        security_context: Optional[JsonDict] = None,
        ttl_seconds: Optional[int] = None,
        json_body: Optional[JsonDict] = None,
        params: Optional[Dict[str, str]] = None,
    ) -> JsonDict:
        """内部请求方法"""
        if not token:
            token = self.make_token(security_context=security_context, ttl_seconds=ttl_seconds)

        url = self._join_url(self.config.base_url, path)
        headers = {
            "Authorization": token,
            "Content-Type": "application/json",
        }

        resp: Response = self.session.request(
            method=method.upper(),
            url=url,
            headers=headers,
            json=json_body,
            params=params,
            timeout=self.config.timeout_seconds,
        )

        # 解析响应
        parsed: JsonDict = {}
        text_fallback = ""
        try:
            parsed = resp.json() if resp.content else {}
        except Exception:
            text_fallback = (resp.text or "").strip()

        if 200 <= resp.status_code < 300:
            return parsed

        # 构建错误信息
        msg_parts = []
        if isinstance(parsed, dict) and parsed:
            msg_parts.append(str(parsed.get("error") or parsed.get("message") or parsed))
        elif text_fallback:
            msg_parts.append(text_fallback)
        else:
            msg_parts.append("Unknown error response")

        raise CubeAPIError(resp.status_code, " | ".join(msg_parts), payload=parsed or {"raw": text_fallback})

    @staticmethod
    def _join_url(base: str, path: str) -> str:
        base = base.rstrip("/")
        path = path.lstrip("/")
        return f"{base}/{path}"

    def meta(self) -> JsonDict:
        """
        GET /meta
        获取 Cube 的元数据，包含所有可用的 cubes、measures、dimensions
        """
        return self._request("GET", "/meta")

    def load(
        self,
        query: JsonDict,
        *,
        query_type: Optional[str] = None,
    ) -> JsonDict:
        """
        POST /load
        执行数据查询
        """
        body: JsonDict = {"query": query}
        if query_type:
            body["queryType"] = query_type

        return self._request("POST", "/load", json_body=body)

    def sql(
        self,
        query: JsonDict,
    ) -> JsonDict:
        """
        POST /sql
        获取查询生成的 SQL（用于调试）
        """
        body: JsonDict = {"query": query}
        return self._request("POST", "/sql", json_body=body)

    def cubesql(
        self,
        sql_query: str,
    ) -> JsonDict:
        """
        POST /cubesql
        执行原始 SQL 查询，可以绕过 Cube 的 GROUP BY 限制
        """
        body: JsonDict = {"query": sql_query}
        return self._request("POST", "/cubesql", json_body=body)


def print_cube_structure(meta: JsonDict, cube_name: Optional[str] = None):
    """打印 Cube 结构信息"""
    cubes_list = meta.get("cubes", [])

    # 将列表转换为字典方便查找
    cubes_dict = {}
    for cube in cubes_list:
        cubes_dict[cube.get("name", cube.get("Name", ""))] = cube

    if cube_name:
        if cube_name not in cubes_dict:
            print(f"Cube '{cube_name}' not found")
            print(f"Available cubes: {list(cubes_dict.keys())}")
            return
        cubes_dict = {cube_name: cubes_dict[cube_name]}

    for name, cube in cubes_dict.items():
        print(f"\n{'='*60}")
        print(f"Cube: {name}")
        print(f"{'='*60}")

        # 打印 measures
        measures = cube.get("measures", [])
        if measures:
            print(f"\n[*] Measures ({len(measures)}):")
            for m in measures:
                print(f"  - {m.get('name')}: {m.get('title', m.get('shortTitle', ''))}")

        # 打印 dimensions
        dimensions = cube.get("dimensions", [])
        if dimensions:
            print(f"\n[*] Dimensions ({len(dimensions)}):")
            for d in dimensions:
                print(f"  - {d.get('name')}: {d.get('title', d.get('shortTitle', ''))} ({d.get('type')})")

        # 打印 segments
        segments = cube.get("segments", [])
        if segments:
            print(f"\n[*] Segments ({len(segments)}):")
            for s in segments:
                print(f"  - {s.get('name')}: {s.get('title', '')}")


def fetch_dwd_standard_products_tag(client: CubeClient, limit: int = 100):
    """
    查询 dwd_standard_products_tag 表数据

    注意：需要先通过 meta 接口查看表结构，然后根据实际的 measures 和 dimensions 调整查询
    """
    cube_name = "dws_standard_products_tag"

    # 首先获取 meta 信息查看表结构
    print(f"Getting {cube_name} table structure...")
    meta = client.meta()

    # 将 cubes 列表转换为字典
    cubes_list = meta.get("cubes", [])
    cubes_dict = {}
    for cube in cubes_list:
        cubes_dict[cube.get("name", cube.get("Name", ""))] = cube

    # 检查 cube 是否存在
    if cube_name not in cubes_dict:
        print(f"[ERROR] Cube '{cube_name}' not found")
        print(f"\nAvailable cubes:")
        for name in cubes_dict.keys():
            print(f"  - {name}")
        return None

    # 打印表结构
    print_cube_structure(meta, cube_name)

    cube = cubes_dict[cube_name]
    measures = [m["name"] for m in cube.get("measures", [])]
    dimensions = [d["name"] for d in cube.get("dimensions", [])]
    print(dimensions)

    # 根据 BigQuery 表结构，dimensions 字段是 JSON 类型，不能用于 GROUP BY
    json_dimensions = ["dws_standard_products_tag.dimensions"]

    # 重要：Cube 的 load 会对 dimensions 做 GROUP BY，BQ 里多行在分组键相同时会合并成一行。
    # 若 Cube 暴露了主键 id，必须加入查询，才能得到「一行一条」的原始行数（与 BQ 一致）。
    id_dim = f"{cube_name}.id"
    if id_dim in dimensions:
        dimensions_for_query = [id_dim] + [d for d in dimensions if d != id_dim and d not in json_dimensions]
        print(f"\n[已包含主键 id] 按行返回，与 BQ 行数一致")
    else:
        dimensions_for_query = [d for d in dimensions if d not in json_dimensions]
        print(f"\n[提示] Cube 未暴露 dimension '{id_dim}'，查询会对当前维度做 GROUP BY，相同维度值的多行会合并为 1 行，故返回行数可能少于 BQ。若需与 BQ 行数一致，请在 Cube 模型中增加 id 维度。")

    # 构建查询 - 只查询 dimensions（字段），不查询 measures（聚合指标）
    query = {
        "limit": limit,
        "offset": 0,
        "timezone": "UTC",
    }
    if dimensions_for_query:
        query["dimensions"] = dimensions_for_query
        print(f"\n查询字段，共 {len(dimensions_for_query)} 个: {query['dimensions']}")
        print("注意: 未使用聚合指标 (measures)，返回原始行数据")

    # 执行查询，如果遇到 JSON GROUP BY 错误则自动排除 JSON 字段重试（仅当未包含 id 时可能仍带 dimensions）
    print(f"\nQuerying data...")
    try:
        result = client.load(query)
    except CubeAPIError as e:
        # 检查是否是 JSON GROUP BY 错误
        if "JSON" in str(e) and ("Grouping" in str(e) or "GROUP BY" in str(e)):
            print(f"\n[自动处理] 检测到 JSON GROUP BY 错误，排除 JSON 字段后重试...")
            dimensions_for_query = [d for d in dimensions if d not in json_dimensions]
            query["dimensions"] = dimensions_for_query
            print(f"查询字段（已排除 JSON），共 {len(dimensions_for_query)} 个: {query['dimensions']}")
            print(f"已排除的 JSON 字段: {json_dimensions}")
            result = client.load(query)
        else:
            # 其他错误直接抛出
            raise

    return result


def fetch_dwd_standard_products_tag_all(
    client: CubeClient,
    *,
    page_size: int = 10000,
    max_rows: Optional[int] = None,
) -> List[JsonDict]:
    """
    分页查询全部数据，直到没有更多记录。

    :param client: Cube 客户端
    :param page_size: 每页条数（单次请求 limit），不宜过大，避免超时
    :param max_rows: 最多拉取条数，None 表示不限制
    :return: 合并后的 data 列表（原始行字典）
    """
    cube_name = "dws_standard_products_tag"
    print(f"Getting {cube_name} meta...")
    meta = client.meta()
    cubes_list = meta.get("cubes", [])
    cubes_dict = {c.get("name", c.get("Name", "")): c for c in cubes_list}
    if cube_name not in cubes_dict:
        print(f"[ERROR] Cube '{cube_name}' not found")
        return []

    cube = cubes_dict[cube_name]
    dimensions = [d["name"] for d in cube.get("dimensions", [])]
    json_dimensions = ["dws_standard_products_tag.dimensions"]
    id_dim = f"{cube_name}.id"
    if id_dim in dimensions:
        dimensions_for_query = [id_dim] + [d for d in dimensions if d != id_dim and d not in json_dimensions]
    else:
        dimensions_for_query = [d for d in dimensions if d not in json_dimensions]

    all_data: List[JsonDict] = []
    offset = 0

    while True:
        limit_this_page = page_size
        if max_rows is not None:
            remaining = max_rows - len(all_data)
            if remaining <= 0:
                break
            limit_this_page = min(limit_this_page, remaining)

        query = {
            "dimensions": dimensions_for_query,
            "limit": limit_this_page,
            "offset": offset,
            "timezone": "UTC",
        }
        try:
            result = client.load(query)
        except CubeAPIError as e:
            if "JSON" in str(e) and ("Grouping" in str(e) or "GROUP BY" in str(e)):
                dimensions_for_query = [d for d in dimensions if d not in json_dimensions]
                query["dimensions"] = dimensions_for_query
                result = client.load(query)
            else:
                raise
        data = result.get("data", [])
        all_data.extend(data)
        print(f"  Fetched offset {offset}, got {len(data)} rows, total so far: {len(all_data)}")

        if len(data) < limit_this_page:
            break
        offset += len(data)
        if max_rows is not None and len(all_data) >= max_rows:
            break

    return all_data


def fetch_with_view(client: CubeClient, limit: int = 6):
    """
    使用 dws_standard_products_tag_view 查询
    View 可能对 JSON 字段有更好的支持
    """
    cube_name = "dws_standard_products_tag_view"

    print(f"\nTrying to query {cube_name} (might have better JSON support)...")

    query = {
        "dimensions": [
            f"{cube_name}.category_id",
            f"{cube_name}.dimensions",
            f"{cube_name}.dimensions_str",
        ],
        "limit": limit,
        "timezone": "UTC",
    }

    print(f"Query: {query}")

    try:
        result = client.load(query)
        return result
    except CubeAPIError as e:
        print(f"[ERROR] View query failed: {e}")
        return None


# 阶段一同步用：view 需包含的维度（resaved_image_path 暂未在 view 中，用 mock 空列表）
VIEW_DIMENSIONS = [
    "dws_standard_products_tag_view.id",
    "dws_standard_products_tag_view.category_id",
    "dws_standard_products_tag_view.dimensions_str",
    "dws_standard_products_tag_view.category_tagged_time",
    "dws_standard_products_tag_view.dimensions_tagged_time",
    "dws_standard_products_tag_view.ingested_at",
    "dws_standard_products_tag_view.analyzed_at",
    "dws_standard_products_tag_view.stored_url",
]


def fetch_view_all(
    client: CubeClient,
    *,
    page_size: int = 5000,
    max_rows: Optional[int] = None,
) -> List[JsonDict]:
    """
    从 dws_standard_products_tag_view 分页拉取全部数据（阶段一同步用）。
    返回 data 列表，每行键为带前缀的 dimension 名（如 dws_standard_products_tag_view.id）。
    """
    cube_name = "dws_standard_products_tag_view"
    all_data: List[JsonDict] = []
    offset = 0

    while True:
        limit_this_page = page_size
        if max_rows is not None:
            remaining = max_rows - len(all_data)
            if remaining <= 0:
                break
            limit_this_page = min(limit_this_page, remaining)

        query = {
            "dimensions": VIEW_DIMENSIONS,
            "limit": limit_this_page,
            "offset": offset,
            "timezone": "UTC",
        }
        result = client.load(query)
        data = result.get("data", [])
        all_data.extend(data)
        if data:
            print(f"  View offset {offset}, got {len(data)} rows, total {len(all_data)}")

        if len(data) < limit_this_page:
            break
        offset += len(data)
        if max_rows is not None and len(all_data) >= max_rows:
            break

    return all_data


def fetch_view_incremental(
    client: CubeClient,
    *,
    since_analyzed_at: Optional[str] = None,
    page_size: int = 5000,
    max_rows: Optional[int] = None,
) -> List[JsonDict]:
    """
    从 dws_standard_products_tag_view 增量拉取（analyzed_at > since_analyzed_at）。
    since_analyzed_at 为 None 时等价于全量拉取（首次同步）。
    返回 data 列表；建议按 analyzed_at 升序，便于用本批 max(analyzed_at) 更新游标。
    """
    cube_name = "dws_standard_products_tag_view"
    all_data: List[JsonDict] = []
    offset = 0

    while True:
        limit_this_page = min(page_size, max_rows - len(all_data)) if max_rows is not None else page_size
        if max_rows is not None and limit_this_page <= 0:
            break

        query: JsonDict = {
            "dimensions": VIEW_DIMENSIONS,
            "limit": limit_this_page,
            "offset": offset,
            "timezone": "UTC",
            "order": {f"{cube_name}.analyzed_at": "asc"},
        }
        # 只拉 dimensions_str、stored_url 非空的数据
        query["filters"] = [
            {"member": f"{cube_name}.dimensions_str", "operator": "set"},
            {"member": f"{cube_name}.stored_url", "operator": "set"},
        ]
        if since_analyzed_at:
            query["filters"].append({
                "member": f"{cube_name}.analyzed_at",
                "operator": "gt",
                "values": [since_analyzed_at],
            })

        result = client.load(query)
        data = result.get("data", [])
        all_data.extend(data)
        if data:
            print(f"  View offset {offset}, got {len(data)} rows, total {len(all_data)}")

        if len(data) < limit_this_page:
            break
        offset += len(data)
        if max_rows is not None and len(all_data) >= max_rows:
            break

    return all_data


def main():
    """主函数"""
    import os
    import json

    # 是否拉取全部数据（可通过环境变量 CUBE_FETCH_ALL=1 开启）
    fetch_all = os.environ.get("CUBE_FETCH_ALL", "").strip() in ("1", "true", "yes")
    fetch_all = True
    page_size = int(os.environ.get("CUBE_PAGE_SIZE", "10000"))
    max_rows_env = os.environ.get("CUBE_MAX_ROWS", "").strip()
    max_rows = int(max_rows_env) if max_rows_env else None

    # 配置
    cfg = CubeConfig(
        base_url="https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1",
        api_secret="032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061",
        token_ttl_seconds=3600,
        timeout_seconds=30,
    )

    # 创建客户端
    client = CubeClient(cfg)

    if fetch_all:
        # 分页拉取全部数据
        print("\n" + "="*60)
        print("Fetch ALL data (paginated)")
        print("="*60)
        data = fetch_dwd_standard_products_tag_all(
            client, page_size=page_size, max_rows=max_rows
        )
        result = {"data": data, "query": {"limit": "all", "offset": 0}}
        print(f"\nTotal rows fetched: {len(data)}")
    else:
        # 只查前几条（默认 6 条）
        print("\n" + "="*60)
        print("Method 1: Cube Load API (with auto-retry)")
        print("="*60)
        result = fetch_dwd_standard_products_tag(client, limit=6)
        data = result.get("data", []) if result else []

    if result and data:
        # 先打印原始结构（全部数据时只打印前几条样本 + 总数）
        print(f"\n{'='*60}")
        print("[Raw API Response] 原始数据:")
        print(f"{'='*60}")
        if len(data) <= 20:
            print(json.dumps({"data": data, "query": result.get("query", {})}, indent=2, ensure_ascii=False))
        else:
            print(json.dumps({"data": data[:3], "query": result.get("query", {}), "_total": len(data), "_note": "showing first 3 rows"}, indent=2, ensure_ascii=False))

        # 再按条打印 data 列表（全部数据时只打印前 20 条）
        print(f"\n{'='*60}")
        print(f"data 共 {len(data)} 条:")
        print(f"{'='*60}")
        show = data[:20] if len(data) > 20 else data
        for i, row in enumerate(show):
            print(f"\n--- Record {i+1} ---")
            for key, value in row.items():
                print(f"  {key}: {value}")
        if len(data) > 20:
            print(f"\n... 仅展示前 20 条，共 {len(data)} 条")

    # 方式2: 解析 dimensions_str 字段获取 JSON 数据
    print("\n\n" + "="*60)
    print("Method 2: Parse 'dimensions_str' as JSON")
    print("="*60)
    print("Note: 'dimensions' field (JSON type) cannot be used in GROUP BY queries.")
    print("      Use 'dimensions_str' instead and parse it as JSON.")

    if result:
        data = result.get("data", [])
        show_count = min(20, len(data))
        print(f"\nParsed JSON from 'dimensions_str' (showing first {show_count} of {len(data)}):")
        for i, row in enumerate(data[:show_count]):
            dims_str = row.get("dws_standard_products_tag.dimensions_str")
            if dims_str:
                try:
                    parsed = json.loads(dims_str)
                    print(f"\n--- Record {i+1} parsed dimensions ---")
                    print(f"  Category ID: {row.get('dws_standard_products_tag.category_id')}")
                    print(f"  Dimensions (JSON): {json.dumps(parsed, indent=4, ensure_ascii=False)}")
                except json.JSONDecodeError as e:
                    print(f"\n--- Record {i+1} ---")
                    print(f"  Error parsing JSON: {e}")
                    print(f"  Raw string: {dims_str}")
            else:
                print(f"\n--- Record {i+1} ---")
                print(f"  dimensions_str is null")


if __name__ == "__main__":
    main()
