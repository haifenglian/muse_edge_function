#!/usr/bin/env python3
"""
图片主体识别与裁剪脚本

基于 图片主体识别.md 中的需求，通过 Hasura 请求 OpenRouter 的 google/gemini-3-flash-preview 模型
进行图像主体识别，并将识别到的主体裁剪保存。

支持 4 类主体：bag(包)、Shoes(鞋)、Accessories(配饰)、clothing(服装)
"""
import argparse
import base64
import json
import os
import re
from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image, ImageOps

# 主体类别映射
CATEGORY_MAP = {
    "3": "bag",
    "4": "shoes",
    "5": "accessories",
    "88888888": "clothing",
}

DEFAULT_PROMPT = """你是一个计算机视觉目标检测模型。
请从输入图片中检测并提取"主体目标"，仅限以下 4 类之一：
- 3：bag（包类，如手提包、背包、钱包、行李袋等）
- 4：Shoes（鞋类，如运动鞋、皮鞋、靴子、凉鞋等）
- 5：Accessories（配饰类，如帽子、围巾、腰带、首饰、眼镜等）
- 88888888：clothing（服装类，如上衣、裤子、裙子、外套等）

【检测规则】
1. 只检测清晰、完整、可识别的主体目标
2. 同一类别可返回多个目标
3. 忽略背景物体、非穿戴类物品、装饰性道具
4. 若目标被严重遮挡、模糊或不可辨认，请不要返回
5. 优先选择画面中视觉占比大、清晰度高的目标

【坐标规则】
- 使用二维边界框 box_2d
- 格式为：[ymin, xmin, ymax, xmax]
- 坐标范围为 0–1000 的归一化整数
- ymin < ymax，xmin < xmax

【输出格式要求】
- 仅返回 JSON
- 不要输出任何解释说明
- 返回一个数组，每个元素结构如下：
{
  "box_2d": [ymin, xmin, ymax, xmax],
  "category": "编号"
}
如果未检测到任何符合条件的主体，请返回空数组 []。"""


def load_image(image_input: str) -> Image.Image:
    """加载图片（支持 URL 或本地路径）."""
    if image_input.startswith(("http://", "https://")):
        with httpx.Client(timeout=30) as client:
            resp = client.get(image_input)
            resp.raise_for_status()
            image = Image.open(BytesIO(resp.content))
    else:
        if not os.path.exists(image_input):
            raise FileNotFoundError(f"图片不存在: {image_input}")
        image = Image.open(image_input)

    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def clean_json_text(text: str) -> str:
    """清理模型返回的 JSON 文本."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def norm_to_pixel(
    ymin: int, xmin: int, ymax: int, xmax: int,
    img_w: int, img_h: int,
    padding_ratio: float = 0.1,
) -> tuple[int, int, int, int]:
    """将 0-1000 归一化坐标转为像素坐标，并应用留白."""
    left_base = (xmin / 1000.0) * img_w
    top_base = (ymin / 1000.0) * img_h
    width_base = ((xmax - xmin) / 1000.0) * img_w
    height_base = ((ymax - ymin) / 1000.0) * img_h

    padding_px = max(width_base, height_base) * padding_ratio
    left = max(0, left_base - padding_px)
    top = max(0, top_base - padding_px)
    right = min(img_w, left_base + width_base + padding_px)
    bottom = min(img_h, top_base + height_base + padding_px)

    left = int(round(left))
    top = int(round(top))
    right = int(round(right))
    bottom = int(round(bottom))

    if right <= left:
        right = min(left + 1, img_w)
    if bottom <= top:
        bottom = min(top + 1, img_h)

    return left, top, right, bottom


HASURA_MUTATION = """
mutation IdentifyObjects($req: SampleInput!) {
  OpenRouterCreateCompletions(req: $req) {
    choices {
      message {
        content
      }
    }
    usage {
      total_tokens
    }
    model
  }
}
"""


def detect_subjects_hasura(
    hasura_url: str,
    image: Image.Image,
    image_input: str,
    model: str,
    headers: dict,
) -> list[dict]:
    """通过 Hasura GraphQL API 调用 OpenRouter 进行主体检测."""
    # 构建消息内容：prompt + 图片（URL 或 base64 data URL）
    if image_input.startswith(("http://", "https://")):
        image_ref = image_input
    else:
        img_byte_arr = BytesIO()
        image.save(img_byte_arr, format="JPEG")
        img_b64 = base64.b64encode(img_byte_arr.getvalue()).decode("utf-8")
        image_ref = f"data:image/jpeg;base64,{img_b64}"

    content = f"{DEFAULT_PROMPT}\n\n![]({image_ref})"

    variables = {
        "req": {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "response_format": {"type": "json_object"},
        }
    }

    payload = {"query": HASURA_MUTATION, "variables": variables}

    with httpx.Client(timeout=120) as client:
        resp = client.post(hasura_url, json=payload, headers=headers)
        resp.raise_for_status()
        result = resp.json()

    if "errors" in result:
        raise RuntimeError(f"Hasura 返回错误: {result['errors']}")

    data = result.get("data", {}).get("OpenRouterCreateCompletions")
    if not data or not data.get("choices"):
        return []

    content = data["choices"][0]["message"]["content"]
    if not content:
        return []

    clean = clean_json_text(content)
    parsed = json.loads(clean)

    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict) and "detections" in parsed:
        return parsed["detections"]
    if isinstance(parsed, dict) and "objects" in parsed:
        return parsed["objects"]
    return []


def crop_subjects(
    image: Image.Image,
    detections: list[dict],
    padding: float = 0.1,
) -> list[tuple[Image.Image, str]]:
    """根据检测结果裁剪主体，返回 (裁剪图, 类别名) 列表."""
    w, h = image.size
    results = []

    for det in detections:
        box = det.get("box_2d")
        if not box or len(box) != 4:
            continue

        ymin, xmin, ymax, xmax = box
        left, top, right, bottom = norm_to_pixel(ymin, xmin, ymax, xmax, w, h, padding)
        cropped = image.crop((left, top, right, bottom))

        cat = str(det.get("category", ""))
        label = CATEGORY_MAP.get(cat, f"unknown_{cat}")
        results.append((cropped, label))

    return results


def main():
    parser = argparse.ArgumentParser(
        description="图片主体识别与裁剪（基于 OpenRouter Gemini）"
    )
    parser.add_argument(
        "image",
        nargs="?",
        default="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1000",
        help="图片路径或 URL（默认: 文档中的示例图）",
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="output/subject_crops",
        help="裁剪结果保存目录（默认: output/subject_crops）",
    )
    parser.add_argument(
        "--padding",
        type=float,
        default=0.1,
        help="裁剪留白比例 0-1（默认: 0.1）",
    )
    parser.add_argument(
        "--model",
        default="google/gemini-3-flash-preview",
        help="OpenRouter 模型名（默认: google/gemini-3-flash-preview）",
    )
    parser.add_argument(
        "--hasura-url",
        default="https://hasura-auth-worker.data-d1a.workers.dev/",
        help="Hasura GraphQL 端点（默认从环境变量 HASURA_URL 读取）",
    )
    parser.add_argument(
        "--hasura-token",
        default="sk_4Obp3aDsbFjjtlzTqj05zTFo4VAWsskB",
        help="Hasura 认证 Token（默认从环境变量 HASURA_AUTH_TOKEN 读取，格式: Bearer xxx）",
    )
    args = parser.parse_args()

    if not args.hasura_url:
        print("错误: 请设置 HASURA_URL 环境变量或使用 --hasura-url 参数")
        return 1

    if not args.hasura_token:
        print("错误: 请设置 HASURA_AUTH_TOKEN 环境变量或使用 --hasura-token 参数")
        return 1

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {args.hasura_token}",
    }

    print(f"加载图片: {args.image}")
    image = load_image(args.image)
    w, h = image.size
    print(f"  尺寸: {w} x {h}")

    print("通过 Hasura 调用模型进行主体检测...")
    detections = detect_subjects_hasura(
        args.hasura_url,
        image,
        args.image,
        args.model,
        headers,
    )
    print(f"  检测到 {len(detections)} 个主体")

    if not detections:
        print("未检测到符合条件的主体")
        return 0

    crops = crop_subjects(image, detections, args.padding)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    base_name = Path(args.image).stem if not args.image.startswith("http") else "image"
    saved = []
    for i, (cropped_img, label) in enumerate(crops):
        fname = f"{base_name}_{label}_{i + 1}.jpg"
        out_path = out_dir / fname
        cropped_img.save(out_path, quality=95)
        saved.append(str(out_path))
        print(f"  保存: {out_path}")

    print(f"\n完成，共保存 {len(saved)} 张裁剪图到 {out_dir}")
    return 0


if __name__ == "__main__":
    exit(main())
