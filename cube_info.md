Cube APIs & integrations
1.API BASE_URL: 
HTTP
https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api
2.生成Token
Node.js 示例：
cube_api_secret : 032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061
JavaScript
const jwt = require("jsonwebtoken")
const CUBE_API_SECRET = {cube_api_secret}

const cubeToken = jwt.sign({}, CUBE_API_SECRET, { expiresIn: "30d" })

3.查询Cube
GraphQL API
1️⃣ 请求方式 & URL
HTTP
POST /graphql
用途：用于数据查询
2️⃣ 请求头（Headers）
参数	类型	必填	说明
Authorization	string	是	Bearer Token
Content-Type	string	是	application/json
3️⃣ 请求体（Body)
HTTP
query {
  cube [([cubeQueryArgs])] {
    <cubeName> [([cubeArgs])] {
      <cubeMember>
    }
  }
}

Key	Description  
cubeQueryArgs	适用于整个查询的选项
cubeArgs	仅适用于特定立方体的选项
参数详情官方文档 ：https://cube.dev/docs/product/apis-integrations/core-data-apis/graphql-api/reference
•请求参数示例：
HTTP
{"query":"{
    cube(limit: 100,offset:0,timezone:'UTC'){
        shopify_sales_profit_view(
            orderBy: {date:desc,sales_orders:asc},
            where: {is_ai_product:{equals: 'N'}}
        ){
            split_payoneer_fee_usd,
            split_paypal_fee_usd,
            split_wastwest_fee_usd,
            brand,
            is_ai_product,
            spu_id,
            sales_orders,
            date {
                value
            }
        }
    }
}"}
•返回示例:
JSON
{
    "data": {
        "cube": [
            {
                "shopify_sales_profit_view": {
                    "split_payoneer_fee_usd": null,
                    "split_paypal_fee_usd": null,
                    "split_wastwest_fee_usd": null,
                    "brand": "JW PEI",
                    "is_ai_product": "N",
                    "spu_id": "4ES040",
                    "sales_orders": null,
                    "date": {
                        "value": "2026-01-05T00:00:00.000Z"
                    }
                }
            },
            {
                "shopify_sales_profit_view": {
                    "split_payoneer_fee_usd": null,
                    "split_paypal_fee_usd": null,
                    "split_wastwest_fee_usd": null,
                    "brand": "JW PEI",
                    "is_ai_product": "N",
                    "spu_id": "2T267X001",
                    "sales_orders": null,
                    "date": {
                        "value": "2026-01-05T00:00:00.000Z"
                    }
                }
            }
            }
}
Cube GraphQL官方文档：https://cube.dev/docs/product/apis-integrations/core-data-apis/graphql-api
REST API
1️⃣ 请求方式 & URL
HTTP
POST /v1/load
2️⃣ 请求头（Headers）
参数	类型	必填	说明
Authorization	string	是	Bearer Token
Content-Type	string	是	application/json
3️⃣ 请求体（Body)
Parameter  	Description  	Required  
query	要么是一个单一的 URL 编码的 Cube 查询，要么是一个查询数组	Yes  
queryType	若在数据混合中传递多个查询，则必须设置为 multi	No  
cache	参见缓存控制。 stale-if-slow 默认情况下	No  
参数详情官方文档：https://cube.dev/docs/product/apis-integrations/core-data-apis/rest-api/reference
•请求参数示例：
HTTP
{
    "query":{
        "measures": ["shopify_sales_profit_view.split_payoneer_fee_usd","shopify_sales_profit_view.split_paypal_fee_usd","shopify_sales_profit_view.split_wastwest_fee_usd","shopify_sales_profit_view.split_other_fee_usd","shopify_sales_profit_view.split_bing_ads_spend_usd","shopify_sales_profit_view.split_google_spend_usd"],
        "dimensions": ["shopify_sales_profit_view.date","shopify_sales_profit_view.brand","shopify_sales_profit_view.spu_id","shopify_sales_profit_view.country"],
        "filters": [
            {
            "member": "shopify_sales_profit_view.is_ai_product",
            "operator": "equals",
            "values": ["N"]
            }
        ],
        "timeDimensions": [
            {
            "dimension": "shopify_sales_profit_view.date",
            "dateRange": ["2015-01-01", "2015-12-31"],
            "granularity": "day"
            }
        ],
        "limit": 100,
        "offset": 0,
        "order": {
            "shopify_sales_profit_view.date": "desc",
            "shopify_sales_profit_view.sales_orders": "desc"
        },
        "timezone": "UTC"
    }
}
•返回示例:
JSON
{
    "query": {
        "measures": [
            "shopify_sales_profit_view.split_payoneer_fee_usd",
            "shopify_sales_profit_view.split_paypal_fee_usd",
            "shopify_sales_profit_view.split_wastwest_fee_usd",
            "shopify_sales_profit_view.split_other_fee_usd",
            "shopify_sales_profit_view.split_bing_ads_spend_usd",
            "shopify_sales_profit_view.split_google_spend_usd"
        ],
        "dimensions": [
            "shopify_sales_profit_view.date",
            "shopify_sales_profit_view.brand",
            "shopify_sales_profit_view.spu_id",
            "shopify_sales_profit_view.country"
        ],
        "timeDimensions": [],
        "limit": 100,
        "offset": 0,
        "timezone": "UTC",
        "filters": [
            {
                "member": "shopify_sales_profit_view.is_ai_product",
                "operator": "equals",
                "values": [
                    "N"
                ]
            }
        ],
        "rowLimit": 100,
        "order": [
            {
                "id": "shopify_sales_profit_view.date",
                "desc": true
            },
            {
                "id": "shopify_sales_profit_view.sales_orders",
                "desc": true
            }
        ]
    },
    "lastRefreshTime": "2026-01-06T06:58:32.159Z",
    "annotation": {
        "measures": {
            "shopify_sales_profit_view.split_payoneer_fee_usd": {
                "title": "Shopify利润模型 Payoneer其它费用",
                "shortTitle": "Payoneer其它费用",
                "description": "Payoneer支付的其它费用，按业务规则分摊到各产品维度，单位为美元",
                "type": "number",
                "drillMembers": [],
                "drillMembersGrouped": {
                    "measures": [],
                    "dimensions": []
                }
            },
            "shopify_sales_profit_view.split_other_fee_usd": {
                "title": "Shopify利润模型 轻流其他费用",
                "shortTitle": "轻流其他费用",
                "description": "除主要支付渠道外的其它费，按业务规则分摊，单位为美元",
                "type": "number",
                "drillMembers": [],
                "drillMembersGrouped": {
                    "measures": [],
                    "dimensions": []
                }
            },
            "shopify_sales_profit_view.split_bing_ads_spend_usd": {
                "title": "Shopify利润模型 Bing广告支出",
                "shortTitle": "Bing广告支出",
                "description": "Bing搜索引擎的广告投放费用，按业务规则分摊到各产品维度，单位为美元",
                "type": "number",
                "drillMembers": [],
                "drillMembersGrouped": {
                    "measures": [],
                    "dimensions": []
                }
            },
            "shopify_sales_profit_view.split_paypal_fee_usd": {
                "title": "Shopify利润模型 PayPal其它费用",
                "shortTitle": "PayPal其它费用",
                "description": "PayPal支付的其它费用，按业务规则分摊到各产品维度，单位为美元",
                "type": "number",
                "drillMembers": [],
                "drillMembersGrouped": {
                    "measures": [],
                    "dimensions": []
                }
            },
            "shopify_sales_profit_view.split_google_spend_usd": {
                "title": "Shopify利润模型 Google广告支出（分摊）",
                "shortTitle": "Google广告支出（分摊）",
                "description": "Google Ads广告平台的投放费用，按业务规则分摊到各产品维度，单位为美元",
                "type": "number",
                "drillMembers": [],
                "drillMembersGrouped": {
                    "measures": [],
                    "dimensions": []
                }
            },
            "shopify_sales_profit_view.split_wastwest_fee_usd": {
                "title": "Shopify利润模型 Wastwest其它费用",
                "shortTitle": "Wastwest其它费用",
                "description": "Wastwest支付的其它费用，按业务规则分摊到各产品维度，单位为美元",
                "type": "number",
                "drillMembers": [],
                "drillMembersGrouped": {
                    "measures": [],
                    "dimensions": []
                }
            }
        },
        "dimensions": {
            "shopify_sales_profit_view.spu_id": {
                "title": "Shopify利润模型 SPU",
                "shortTitle": "SPU",
                "description": "标准产品单元ID，用于识别和分析特定产品的销售数据",
                "type": "string"
            },
            "shopify_sales_profit_view.country": {
                "title": "Shopify利润模型 国家",
                "shortTitle": "国家",
                "description": "订单发货国家，用于地域销售分析",
                "type": "string"
            },
            "shopify_sales_profit_view.date": {
                "title": "Shopify利润模型 日期",
                "shortTitle": "日期",
                "description": "订单创建日期，用于时间序列分析和趋势追踪",
                "type": "time"
            },
            "shopify_sales_profit_view.brand": {
                "title": "Shopify利润模型 品牌",
                "shortTitle": "品牌",
                "description": "产品所属品牌名称，用于区分不同品牌的销售表现",
                "type": "string"
            }
        },
        "timeDimensions": {},
        "segments": {}
    },
    "dataSource": "default",
    "dbType": "bigquery",
    "extDbType": "cubestore",
    "external": false,
    "slowQuery": false,
    "data": [
        {
            "shopify_sales_profit_view.date": "2026-01-05",
            "shopify_sales_profit_view.brand": "JW PEI",
            "shopify_sales_profit_view.spu_id": "2T20",
            "shopify_sales_profit_view.country": "NO",
            "shopify_sales_profit_view.split_payoneer_fee_usd": null,
            "shopify_sales_profit_view.split_paypal_fee_usd": null,
            "shopify_sales_profit_view.split_wastwest_fee_usd": null,
            "shopify_sales_profit_view.split_other_fee_usd": null,
            "shopify_sales_profit_view.split_bing_ads_spend_usd": null,
            "shopify_sales_profit_view.split_google_spend_usd": 0.0
        },
        {
            "shopify_sales_profit_view.date": "2026-01-05",
            "shopify_sales_profit_view.brand": "JW PEI",
            "shopify_sales_profit_view.spu_id": "DS151",
            "shopify_sales_profit_view.country": "KR",
            "shopify_sales_profit_view.split_payoneer_fee_usd": null,
            "shopify_sales_profit_view.split_paypal_fee_usd": null,
            "shopify_sales_profit_view.split_wastwest_fee_usd": null,
            "shopify_sales_profit_view.split_other_fee_usd": null,
            "shopify_sales_profit_view.split_bing_ads_spend_usd": null,
            "shopify_sales_profit_view.split_google_spend_usd": 0.0
        }
    ]
}
Cube Restful官方文档：https://cube.dev/docs/product/apis-integrations/core-data-apis/rest-api

Python代码示例:
[cube_client.py]
Python
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Union

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
    base_url examples:
      - https://<your-domain>/cubejs-api/v1
      - http://localhost:4000/cubejs-api/v1
    """
    base_url: str
    api_secret: str
    algorithm: str = "HS256"
    token_ttl_seconds: int = 3600
    timeout_seconds: int = 30
    user_agent: str = "cube-python-client/1.0"

class CubeClient:
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

        # Robust retry for transient errors (network / 429 / 5xx)
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

    # ---------- Auth ----------
    def make_token(
        self,
        *,
        security_context: Optional[JsonDict] = None,
        ttl_seconds: Optional[int] = None,
        extra_claims: Optional[JsonDict] = None,
    ) -> str:
        """
        Create a JWT token for Cube.
        - security_context: your custom fields (e.g. user_id, role, tenant_id...)
        - ttl_seconds: token lifetime
        - extra_claims: additional JWT claims if needed
        """
        now = int(time.time())
        exp = now + int(ttl_seconds or self.config.token_ttl_seconds)

        ctx = dict(self.default_security_context)
        if security_context:
            ctx.update(security_context)

        payload: JsonDict = {
            "iat": now,
            "exp": exp,
            **ctx,  # Cube uses these fields as security context
        }
        if extra_claims:
            payload.update(extra_claims)

        token = jwt.encode(payload, self.config.api_secret, algorithm=self.config.algorithm)

        # PyJWT v1 may return bytes; v2 returns str
        if isinstance(token, bytes):
            token = token.decode("utf-8")
        return token

    # ---------- Low-level request ----------
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
        """
        Internal request helper. Raises CubeAPIError on non-2xx.
        """
        if not token:
            token = self.make_token(security_context=security_context, ttl_seconds=ttl_seconds)

        url = self._join_url(self.config.base_url, path)
        headers = {
            "Authorization": token,  # Cube expects raw JWT in Authorization header
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

        # Try parse json (Cube usually returns JSON even on error)
        parsed: JsonDict = {}
        text_fallback = ""
        try:
            parsed = resp.json() if resp.content else {}
        except Exception:
            text_fallback = (resp.text or "").strip()

        if 200 <= resp.status_code < 300:
            return parsed

        # Build a helpful error message
        msg_parts = []
        if isinstance(parsed, dict) and parsed:
            # Cube errors often include "error" or "message"
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

    # ---------- High-level Cube endpoints ----------
    def meta(
        self,
        *,
        token: Optional[str] = None,
        security_context: Optional[JsonDict] = None,
        ttl_seconds: Optional[int] = None,
    ) -> JsonDict:
        """
        GET /meta
        """
        return self._request(
            "GET",
            "/meta",
            token=token,
            security_context=security_context,
            ttl_seconds=ttl_seconds,
        )

    def load(
        self,
        query: JsonDict,
        *,
        token: Optional[str] = None,
        security_context: Optional[JsonDict] = None,
        ttl_seconds: Optional[int] = None,
        query_type: Optional[str] = None,
        # query_type could be "multi" for multi-queries (depending on your usage)
    ) -> JsonDict:
        """
        POST /load
        body = {"query": {...}} OR {"queryType": "...", "query": {...}} (optional)
        """
        body: JsonDict = {"query": query}
        if query_type:
            body["queryType"] = query_type

        return self._request(
            "POST",
            "/load",
            token=token,
            security_context=security_context,
            ttl_seconds=ttl_seconds,
            json_body=body,
        )

    def sql(
        self,
        query: JsonDict,
        *,
        token: Optional[str] = None,
        security_context: Optional[JsonDict] = None,
        ttl_seconds: Optional[int] = None,
    ) -> JsonDict:
        """
        POST /sql
        Returns generated SQL for the given Cube query (useful for debugging).
        """
        body: JsonDict = {"query": query}
        return self._request(
            "POST",
            "/sql",
            token=token,
            security_context=security_context,
            ttl_seconds=ttl_seconds,
            json_body=body,
        )

if __name__ == "__main__":
    # ---- Example usage ----
    cfg = CubeConfig(
        base_url="https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1",
        api_secret="032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061",
        token_ttl_seconds=3600,
        timeout_seconds=30,
    )

    client = CubeClient(
        cfg,
        default_security_context={
            # 全局默认 context（可选）
            # "role": "viewer",
        },
    )

    # 1) Call /meta
    # meta = client.meta(security_context={"user_id": "kitty", "role": "developer"})
    # print("meta keys:", meta.keys())

    # 2) Call /load
    q = {
        "measures": ["instagram_profile_scraper_latest_view.count","instagram_profile_scraper_latest_view.followerscount"],
        "dimensions": ["instagram_profile_scraper_latest_view.id","instagram_profile_scraper_latest_view.status"],
        "limit": 100
    }
    res = client.load(q, security_context={"user_id": "kitty", "role": "developer"})
    print(res)

    # 3) Call /sql (debug)
    # sql_res = client.sql(q, security_context={"user_id": "kitty", "role": "developer"})
    # print(sql_res)

4.提示词
通过Vibe Coding方式连接Cube可以参考以下提示词: 
目标：
        通过Cube Cloud Restfui接口获取指标和维度数据.
        
要求：
        查阅Cube Cloud官方文档,保证正确接入。
        以下为可参考的Cube Cloud Restfui官方文档链接:
                https://cube.dev/docs/product/apis-integrations/core-data-apis/rest-api
                https://cube.dev/docs/product/apis-integrations/core-data-apis/rest-api/query-format
                https://cube.dev/docs/product/apis-integrations/core-data-apis/rest-api/reference
        
指令:
        1.当前请求参数为(例):
                {
                  "measures": ["ads_ai_adtesting_spu_daily_view.target_roi"],
                  "dimensions": ["ads_ai_adtesting_spu_daily_view.sample_code"],
                  "filters": [
                        {
                          "member": "ads_ai_adtesting_spu_daily_view.country_cn",
                          "operator": "contains",
                          "values": ["N"]
                        }
                  ],
                  "limit": 5000,
                  "order": {
                        "ads_ai_adtesting_spu_daily_view.date: "desc",
                  },
                }
        2.通过请求获取到指标和维度数据后，渲染至XX页面的XX元素.

约束:
        其他部分代码保持不变.
