# 阿里云图搜同步队列方案

## 背景

- 需要将约 cube 中的图片数据同步到阿里云图搜服务
- 通过 Hasura 接口调用，有 **5 QPS** 限制

## 阶段一：Cube → Supabase 同步（增量）

1. **建表**：在 Supabase SQL Editor 中执行 [supabase/migrations/001_schema.sql](supabase/migrations/001_schema.sql)，创建 `standard_products_tag`（产品表）、`aliyun_sync_tasks`（阿里云同步任务表）、`sync_state`（增量游标表）。
2. **环境变量**：设置 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（或 `SUPABASE_KEY`）。可选：`CUBE_PAGE_SIZE`（默认 5000）、`CUBE_MAX_ROWS`（单次最多拉取条数，不设则拉完本批增量）。
3. **运行同步**：`pip install -r requirements.txt` 后执行 `python sync_cube_to_supabase.py`。
   - **首次运行**：无游标，从 Cube **全量**拉取，写入产品表与任务表，并将本批最大 `ingested_at` 写入 `sync_state`（key=`cube_last_ingested_at`）。
   - **后续运行**：读取 `sync_state` 中的 `cube_last_ingested_at`，只拉 **ingested_at > 游标** 的数据，拉完后更新游标。产品表 upsert、任务表仅插入新任务（重复跳过）。
4. **定时**：可用 cron 或 Supabase Edge Function 定时每 5～15 分钟执行一次。

## cube 参考文档

https://o0sqq7lmwa0.feishu.cn/wiki/NxYewQs03iB05jk9BXrc5aOBnyf

cube中的表：`dwd_standard_products_tag` 

## Cube API 配置

| 配置项 | 值 |
|--------|-----|
| Base URL | `https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1` |
| API Secret | `032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061` |
| 认证方式 | JWT Token (HS256) |

## 表结构：dws_standard_products_tag

### BigQuery Schema

| 字段名 | BigQuery 类型 | Mode | 说明 | Cube 类型 |
|--------|---------------|------|------|-----------|
| `id` | STRING | REQUIRED | 主键 | - |
| `category_id` | INTEGER | NULLABLE | AI识别的品类ID | number |

| `dimensions` | JSON | NULLABLE | AI提取的维度值 | string/JSON |
| `dimensions_str` | STRING | NULLABLE | AI提取的维度值字符串 | string/JSON |
| `category_tagged_time` | TIMESTAMP | NULLABLE | 品类打标时间 | time |
| `dimensions_tagged_time` | TIMESTAMP | NULLABLE | 维度打标时间 | time |
| `ingested_at` | TIMESTAMP | NULLABLE | 入库时间 | time |

### Cube 聚合字段

| 字段名 | 说明 |
|--------|------|
| `dws_standard_products_tag.count` | 记录数聚合 (COUNT) |

### 重要说明

1. **`id` 字段**：主键，但在 Cube 的 Dimensions 中未暴露
2. **时间字段**：所有时间字段为 TIMESTAMP 类型，查询时返回 ISO 8601 格式

### 为什么通过 Cube 查到的行数少于 BQ？

Cube 的 `/load` 会对请求里的 **dimensions 做 GROUP BY**。BQ 表里有多条记录时，只要这些记录的「维度组合」相同，在 Cube 里就会**合并成一行**。

- 例如 BQ 里 4 条：`category_id=88888888`、`dimensions_str=null`、`dimensions_tagged_time=null`，其余时间相同 → 在 Cube 里会变成 **1 行**。
- 要得到和 BQ **一行一条**一致的结果，必须在分组键里包含「每行都不同」的字段，即主键 **`id`**。

**解决办法**：在 Cube 模型里把 BQ 的 `id` 暴露为 dimension（例如 `dws_standard_products_tag.id`）。查询时脚本会自动带上 `id`，返回行数就会与 BQ 一致。

### 数据示例

```json
{
  "dws_standard_products_tag.category_id": 88888888.0,
  "dws_standard_products_tag.category_tagged_time": "2026-01-23T07:18:18.685",
  "dws_standard_products_tag.dimensions_tagged_time": null,
  "dws_standard_products_tag.ingested_at": "2026-01-23T07:18:39.394",
  "dws_standard_products_tag.count": 4.0
}
```

## Cube REST API 使用说明

### Postman 调试

#### 1. 获取 JWT Token

在项目目录下执行（需已安装 `pip install pyjwt`）：

```bash
python -c "
import jwt, time
secret = '032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061'
payload = {'iat': int(time.time()), 'exp': int(time.time()) + 3600}
token = jwt.encode(payload, secret, algorithm='HS256')
print(token if isinstance(token, str) else token.decode())
"
```

复制输出的字符串，在 Postman 里用作 Bearer Token。

#### 2. 在 Postman 中配置

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **URL** | `https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1/load` |

**Headers：**

| Key | Value |
|-----|--------|
| `Authorization` | `Bearer <上一步复制的 token>` |
| `Content-Type` | `application/json` |

**Body** → 选择 **raw** → **JSON**，填入下面其一。

**查表数据（/load）：**
```json
{
  "query": {
    "dimensions": [
      "dws_standard_products_tag.category_id",
      "dws_standard_products_tag.dimensions_str",
      "dws_standard_products_tag.category_tagged_time",
      "dws_standard_products_tag.dimensions_tagged_time",
      "dws_standard_products_tag.ingested_at"
    ],
    "limit": 6,
    "offset": 0,
    "timezone": "UTC"
  }
}
```

**查元数据（/meta，看有哪些 cube/dimensions）：**

- Method 改为 `GET`
- URL 改为：`https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1/meta`
- 无需 Body，只需 Header 里 `Authorization: Bearer <token>`

#### 3. 发送请求

点击 **Send**，在下方查看返回的 JSON。Token 有效期 1 小时，过期后重新执行步骤 1 生成新 token。

---

### 请求格式（参考）

**POST** `/v1/load`

**请求头：**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**请求体：**
```json
{
  "query": {
    "measures": ["dws_standard_products_tag.count"],
    "dimensions": [
      "dws_standard_products_tag.category_id",
      "dws_standard_products_tag.category_tagged_time"
    ],
    "limit": 100,
    "offset": 0,
    "timezone": "UTC",
    "order": {
      "dws_standard_products_tag.category_tagged_time": "desc"
    }
  }
}
```

### Python 客户端代码

参考脚本：`fetch_cube_data.py`

```python
from fetch_cube_data import CubeClient, CubeConfig

# 配置
cfg = CubeConfig(
    base_url="https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1",
    api_secret="032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061",
)

# 创建客户端
client = CubeClient(cfg)

# 查询数据
query = {
    "measures": ["dws_standard_products_tag.count"],
    "dimensions": ["dws_standard_products_tag.category_id"],
    "limit": 100,
}

result = client.load(query)
data = result.get("data", [])
```

### 重要注意事项

1. **JSON 字段不能用于 GROUP BY**：`dimensions` 和 `dimensions_str` 字段是 JSON 类型，查询时不能包含在 `dimensions` 中，否则会报错：`Grouping by expressions of type JSON is not allowed`

2. **表名正确拼写**：是 `dws_standard_products_tag` 不是 `dwd_standard_products_tag`

3. **分页处理**：使用 `limit` 和 `offset` 进行分页，建议每页 100-1000 条记录

4. **Token 有效期**：默认 3600 秒（1小时），可配置 `token_ttl_seconds` 参数

5. **5 QPS 限制**：同步到阿里云图搜时有 QPS 限制，需要控制请求频率

## 请求阿里云图搜接口

请求地址：https://hasura-auth-worker.data-d1a.workers.dev/



额外请求头
{
  "Authorization": "Bearer sk_4Obp3aDsbFjjtlzTqj05zTFo4VAWsskB"  // token从环境变量获取HASURA_ACCESS_TOKEN
}

```shell
mutation AddImage($input: AddImageInput!) {
  ali {addImage(input: $input) {
    Success
    Message
    RequestId
    Code
  }
}
}
```

参数示例
```shell
{
  "input": {
    "instanceName": "muse",
    "productId": "sku_12345",
    "picName": "front.jpg",
    "picUrl": "https://cdn.example.com/products/12345.jpg",
    "customContent": "{\"material_code\":\"MN035349-P1\",\"processed_url\":\"https://storage.googleapis.com/material_management_system/image/processed_image_20251230_051449_57b26067.jpg\"}"
  }
}
```