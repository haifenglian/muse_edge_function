# 主体检测接口文档

## 接口概述

通过图片 URL 调用大模型进行主体检测，识别包、鞋、配饰、服装四类目标，裁剪后上传至 Google Cloud Storage，返回裁剪图的公网 URL 及类别信息。

**调用链路**：客户端 → 本服务 → Hasura → OpenRouter → 大模型（默认 google/gemini-3-flash-preview）

---

## 接口信息

| 项目 | 说明 |
|------|------|
| 请求方式 | POST |
| 请求路径 | `/api/v1/subject-detection/detect-and-upload` |
| Content-Type | application/json |
| 完整示例 | `https://trend-hunter-recognition-614785993139.asia-southeast1.run.app` |

---

## 请求参数

### 请求体（JSON）

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| image_url | string | 是 | - | 图片的 HTTP/HTTPS URL，需可公网访问 |
| padding | number | 否 | 0.1 | 裁剪留白比例，范围 0–0.5。0=无留白，0.1=10%留白 |
| model | string | 否 | 配置默认值 | OpenRouter 模型名，如 `google/gemini-3-flash-preview`、`google/gemini-2.5-flash` |

### 请求示例

```json
{
  "image_url": "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1000",
  "padding": 0.1
}
```

指定模型：

```json
{
  "image_url": "https://example.com/your-image.jpg",
  "padding": 0.15,
  "model": "google/gemini-2.5-flash"
}
```

---

## 响应格式

### 统一响应结构

所有响应均包含 `code`、`msg`、`data` 三个字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| code | int | 状态码，0=成功，非0=失败 |
| msg | string | 响应消息 |
| data | object \| null | 响应数据，失败时为 null |

### 成功响应（code=0）

```json
{
  "code": 0,
  "msg": "检测完成",
  "data": {
    "detections": [
      {
        "gcs_url": "https://storage.googleapis.com/your-bucket/subject_detection/20250202120000_abc12345/3_1.jpg",
        "category": "3",
        "category_name": "bag",
        "box_2d": [181, 355, 966, 615]
      },
      {
        "gcs_url": "https://storage.googleapis.com/your-bucket/subject_detection/20250202120000_abc12345/4_2.jpg",
        "category": "4",
        "category_name": "shoes",
        "box_2d": [912, 439, 977, 502]
      }
    ],
    "total_count": 2
  }
}
```

### data 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| detections | array | 检测到的主体列表 |
| total_count | int | 检测到的主体数量 |

### detections 单项说明

| 字段 | 类型 | 说明 |
|------|------|------|
| gcs_url | string | 裁剪图在 GCS 的公网 URL |
| category | string | 类别编号（大模型原始返回）：3=包，4=鞋，5=配饰，88888888=服装 |
| category_name | string | 类别名称：bag、shoes、accessories、clothing |
| box_2d | array | 归一化边界框 [ymin, xmin, ymax, xmax]，坐标范围 0–1000 |

### 类别对照表

| category | category_name | 含义 |
|----------|---------------|------|
| 3 | bag | 包类（手提包、背包、钱包等） |
| 4 | shoes | 鞋类（运动鞋、皮鞋、靴子等） |
| 5 | accessories | 配饰类（帽子、围巾、首饰等） |
| 88888888 | clothing | 服装类（上衣、裤子、裙子等） |

---

## 错误响应

### 400 Bad Request

参数错误，如 `image_url` 未填。

```json
{
  "code": 400,
  "msg": "image_url 必填",
  "data": null
}
```

### 502 Bad Gateway

Hasura 或 GCS 服务异常。

```json
{
  "code": 502,
  "msg": "检测服务异常: Hasura 返回错误: ...",
  "data": null
}
```

### 503 Service Unavailable

服务配置缺失（HASURA_URL、HASURA_AUTH_TOKEN、GCS_BUCKET 未配置）。

```json
{
  "code": 503,
  "msg": "主体检测服务配置缺失: 请设置 HASURA_URL, HASURA_AUTH_TOKEN, GCS_BUCKET",
  "data": null
}
```

---

## 调用示例

### cURL

```bash
curl -X POST "https://your-domain.com/api/v1/subject-detection/detect-and-upload" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1000", "padding": 0.1}'
```

### JavaScript (fetch)

```javascript
const response = await fetch('https://your-domain.com/api/v1/subject-detection/detect-and-upload', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    image_url: 'https://example.com/image.jpg',
    padding: 0.1,
    model: 'google/gemini-3-flash-preview'
  })
});
const result = await response.json();
```

### Python (requests)

```python
import requests

resp = requests.post(
    'https://your-domain.com/api/v1/subject-detection/detect-and-upload',
    json={
        'image_url': 'https://example.com/image.jpg',
        'padding': 0.1,
    },
    headers={'Content-Type': 'application/json'}
)
result = resp.json()
```

---

## 注意事项

1. **image_url** 必须为可公网访问的 HTTP/HTTPS 地址，服务端会下载该图片进行分析。
2. **未检测到主体** 时返回 `detections: []`、`total_count: 0`，仍为成功响应（code=0）。
3. **box_2d** 为 0–1000 的归一化坐标，如需像素坐标需根据原图尺寸换算。
4. **GCS URL** 需确保存储桶已配置为可公网读取，否则返回的 URL 可能无法访问。
