/**
 * Edge Function：消费电商主体识别任务
 *
 * 调用主体识别 API 对 pending 状态的图片进行检测，
 * 识别成功后更新任务状态并写入 ai_match 表供后续图搜。
 *
 * 需配置 Secrets：HASURA_API_TOKEN 或 HASURA_ACCESS_TOKEN（必填）
 * 需配置 Secrets：SUBJECT_DETECTION_API_URL（可选，有默认）
 * 可选：BATCH_SIZE（默认 10）
 * 可选：ENABLE_SUBJECT_DETECTION（是否启用主体识别，默认 false）
 * 可选：ALIYUN_GRAPHQL_URL（可选，有默认，用于 AI 打标）
 *
 * 接口：
 *   GET  /functions/v1/consume-ecommerce-subject-tasks
 *        返回当前 pending 数量，不执行识别。
 *   POST /functions/v1/consume-ecommerce-subject-tasks
 *        触发一次批量识别。可选查询参数：?batch_size=10
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const SOURCE_TABLE = "ods_ecommerce";

// 主体识别 API 请求类型
type DetectRequest = {
  image_url: string;
  padding?: number;
};

// 主体识别 API 响应类型
type DetectResponse = {
  code: number;
  msg: string;
  data: {
    detections: Array<{
      gcs_url: string;
      category: string;
      category_name: string;
      box_2d: number[];
    }>;
    total_count: number;
  } | null;
};

async function callSubjectDetection(
  apiUrl: string,
  imageUrl: string
): Promise<{ success: boolean; detections: DetectResponse["data"]["detections"]; error?: string }> {
  try {
    const payload: DetectRequest = {
      image_url: imageUrl,
      padding: 0.1,
    };

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return { success: false, detections: [], error: `HTTP ${res.status}: ${await res.text()}` };
    }

    const json = (await res.json()) as DetectResponse;

    if (json.code !== 0) {
      return { success: false, detections: [], error: json.msg || "Unknown error" };
    }

    return { success: true, detections: json.data?.detections ?? [] };
  } catch (e) {
    return { success: false, detections: [], error: String(e) };
  }
}

// OpenRouter 图像分类 GraphQL 查询
const CLASSIFICATION_QUERY = `
mutation ProxyToOpenRouter($req: SampleInput!) {
  OpenRouterCreateCompletions(req: $req) {
    choices {
      index
      finish_reason
      message {
        role
        content
        tool_calls {
          id
          type
          function {
            name
            arguments
          }
        }
      }
    }
    usage {
      total_tokens
      prompt_tokens
      completion_tokens
    }
    error {
      message
      code
    }
  }
}
`;

type SampleInput = {
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  response_format?: {
    type: string;
  };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
};

type OpenRouterResult = {
  OpenRouterCreateCompletions?: {
    choices?: Array<{
      index?: number;
      finish_reason?: string;
      message?: {
        role?: string;
        content?: string;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
      };
    }>;
    usage?: {
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    error?: {
      message?: string;
      code?: string;
    };
  };
};

async function callClassification(
  graphqlUrl: string,
  token: string,
  imageUrl: string
): Promise<{ success: boolean; category: string | null; error?: string }> {
  const prompt = `你是一个计算机视觉目标检测模型。
请从输入图片中检测并提取"主体目标"，仅限以下 4 类之一：
- 3：bag（包类，如手提包、背包、钱包、行李袋等）
- 4：Shoes（鞋类，如运动鞋、皮鞋、靴子、凉鞋等）
- 5：Accessories（配饰类，如帽子、围巾、腰带、首饰、眼镜等）
- 88888888：clothing（服装类，如上衣、裤子、裙子、外套等）
【检测规则】
1. 只检测清晰、完整、可识别的主体目标
3. 忽略背景物体、非穿戴类物品、装饰性道具
4. 若目标被严重遮挡、模糊或不可辨认，请不要返回
5. 优先选择画面中视觉占比大、清晰度高的目标
【输出格式要求】
- 仅返回 JSON
- 不要输出任何解释说明
- 返回结构如下：
{
  "category": "编号"
}`;

  try {
    const req: SampleInput = {
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
      response_format: {
        type: "json_object",
      },
      temperature: 0.2,
      max_tokens: 1000,
      stream: false,
    };

    console.log("[consume-ecommerce-subject-tasks] calling classification API, image_url =", imageUrl.slice(0, 50) + "...");

    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: CLASSIFICATION_QUERY, variables: { req } }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[consume-ecommerce-subject-tasks] classification HTTP error:", res.status, errorText);
      return { success: false, category: null, error: `HTTP ${res.status}: ${errorText}` };
    }

    const json = (await res.json()) as { data?: OpenRouterResult; errors?: unknown[] };

    if (json.errors?.length) {
      console.error("[consume-ecommerce-subject-tasks] classification GraphQL errors:", JSON.stringify(json.errors));
      return { success: false, category: null, error: JSON.stringify(json.errors) };
    }

    // 检查错误
    const error = json.data?.OpenRouterCreateCompletions?.error;
    if (error?.message) {
      console.error("[consume-ecommerce-subject-tasks] classification API error:", error.message, error.code);
      return { success: false, category: null, error: error.message };
    }

    const content = json.data?.OpenRouterCreateCompletions?.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[consume-ecommerce-subject-tasks] classification no content in response:", JSON.stringify(json.data));
      return { success: false, category: null, error: "No content in response" };
    }

    // 解析返回的 JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("[consume-ecommerce-subject-tasks] classification failed to parse JSON:", content);
      return { success: false, category: null, error: "Failed to parse response JSON" };
    }

    const category = (parsed as { category?: string }).category;
    if (!category) {
      console.error("[consume-ecommerce-subject-tasks] classification no category in parsed result:", parsed);
      return { success: false, category: null, error: "No category in parsed result" };
    }

    console.log("[consume-ecommerce-subject-tasks] classification success, category =", category);
    return { success: true, category };
  } catch (e) {
    console.error("[consume-ecommerce-subject-tasks] classification exception:", e);
    return { success: false, category: null, error: String(e) };
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const pathname = new URL(req.url).pathname;
  console.log(JSON.stringify({ msg: "consume-ecommerce-subject-tasks invoked", method: req.method, path: pathname }));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // GET：返回 pending 数量
    if (req.method === "GET") {
      const { count, error } = await supabase
        .from("ecommerce_subject_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) return jsonResponse({ ok: false, error: error.message }, 500);

      const enableDetection = Deno.env.get("ENABLE_SUBJECT_DETECTION") === "true";

      return jsonResponse({
        ok: true,
        pending: count ?? 0,
        detectionEnabled: enableDetection,
        message: enableDetection
          ? "使用 POST 触发一次批量主体识别（裁剪图片）。"
          : "主体识别已关闭，将使用原始图片并调用 AI 打标。设置 ENABLE_SUBJECT_DETECTION=true 启用裁剪。",
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "仅支持 GET 与 POST" }, 405);
    }

    const url = new URL(req.url);
    const batchSizeParam = url.searchParams.get("batch_size");
    const batchSize = batchSizeParam ? parseInt(batchSizeParam, 10) : parseInt(Deno.env.get("BATCH_SIZE") ?? "10", 10);

    const detectionApiUrl = Deno.env.get("SUBJECT_DETECTION_API_URL") ??
      "https://trend-hunter-recognition-614785993139.asia-southeast1.run.app/api/v1/subject-detection/detect";

    // 获取 Hasura GraphQL 配置（用于 AI 打标）
    const token = Deno.env.get("HASURA_API_TOKEN") ?? Deno.env.get("HASURA_ACCESS_TOKEN");
    if (!token?.trim()) {
      return jsonResponse({ ok: false, error: "HASURA_API_TOKEN 未配置" }, 500);
    }
    const graphqlUrl = (Deno.env.get("ALIYUN_GRAPHQL_URL") ?? "https://hasura-auth-worker.data-d1a.workers.dev/").replace(/\/$/, "");

    // 主体识别开关：默认关闭
    const enableDetection = Deno.env.get("ENABLE_SUBJECT_DETECTION") === "true";

    console.log("[consume-ecommerce-subject-tasks] POST: consuming tasks, batch_size =", batchSize, "enable_detection =", enableDetection, "detection_api_url =", detectionApiUrl, "graphql_url =", graphqlUrl);

    // 拉取 pending 任务
    const { data: tasks, error: fetchError } = await supabase
      .from("ecommerce_subject_tasks")
      .select("*")
      .eq("status", "pending")
      .limit(batchSize);

    if (fetchError) {
      return jsonResponse({ ok: false, error: fetchError.message }, 500);
    }

    if (!tasks?.length) {
      console.log("[consume-ecommerce-subject-tasks] no pending tasks");
      return jsonResponse({
        ok: true,
        processed: 0,
        success: 0,
        failed: 0,
        noDetection: 0,
        detectionEnabled: enableDetection,
      });
    }

    console.log("[consume-ecommerce-subject-tasks] fetched", tasks.length, "pending tasks");

    let success = 0;
    let failed = 0;
    let noDetection = 0;
    let skipped = 0;  // 跳过主体识别的计数

    for (const task of tasks) {
      const taskId = task.id;
      const sourceId = task.source_id;
      const sourceName = task.source_name;
      const imageUrl = task.image_url;
      const productId = task.product_id;
      const productName = task.product_name;
      const position = task.position;

      console.log("[consume-ecommerce-subject-tasks] processing task", taskId, "source_id =", sourceId, "product_id =", productId, "position =", position, "image_url =", imageUrl);

      let cropImage: string | null = null;
      let category: string | null = null;

      if (enableDetection) {
        // 启用主体识别：调用 AI API
        const result = await callSubjectDetection(detectionApiUrl, imageUrl);

        if (!result.success) {
          failed++;
          await supabase
            .from("ecommerce_subject_tasks")
            .update({ status: "failed", error_message: result.error, updated_at: new Date().toISOString() })
            .eq("id", taskId);
          console.error("[consume-ecommerce-subject-tasks] detection failed", taskId, result.error);
          continue;
        }

        const detections = result.detections;

        if (detections.length === 0) {
          // 未检测到主体，标记为失败
          noDetection++;
          await supabase
            .from("ecommerce_subject_tasks")
            .update({ status: "failed", error_message: "未检测到主体", updated_at: new Date().toISOString() })
            .eq("id", taskId);
          console.log("[consume-ecommerce-subject-tasks] no detection", taskId);
          continue;
        }

        // 取第一个检测结果
        const firstDetection = detections[0];
        cropImage = firstDetection.gcs_url;
        category = firstDetection.category;
      } else {
        // 关闭主体识别：直接使用原始图片，但需要调用 AI 打标获取类别
        console.log("[consume-ecommerce-subject-tasks] detection disabled, calling classification API", taskId);
        const classifyResult = await callClassification(graphqlUrl, token, imageUrl);

        if (!classifyResult.success) {
          failed++;
          await supabase
            .from("ecommerce_subject_tasks")
            .update({ status: "failed", error_message: classifyResult.error, updated_at: new Date().toISOString() })
            .eq("id", taskId);
          console.error("[consume-ecommerce-subject-tasks] classification failed", taskId, classifyResult.error);
          continue;
        }

        cropImage = imageUrl;
        category = classifyResult.category;
        skipped++;
        console.log("[consume-ecommerce-subject-tasks] classification done", taskId, "category =", category);
      }

      // 更新任务状态为 done
      const { error: updateError } = await supabase
        .from("ecommerce_subject_tasks")
        .update({
          status: "done",
          crop_image: cropImage,
          category_id: category,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      if (updateError) {
        failed++;
        console.error("[consume-ecommerce-subject-tasks] update task failed", taskId, updateError.message);
        continue;
      }

      // 写入 ai_match 表
      const aiMatchData = {
        crop_image: cropImage,
        category_id: category,
        standard_product_id: null, // 待图搜匹配
        confidence: 0,
        source_table: SOURCE_TABLE,
        source_id: sourceId,
        source_name: sourceName,
        image_index: position,
        stored_url: imageUrl,
      };

      const { error: insertError } = await supabase
        .from("ai_match")
        .insert(aiMatchData);

      if (insertError) {
        // 如果是唯一约束冲突，尝试更新
        // 但只更新未匹配的记录（standard_product_id IS NULL），避免覆盖已匹配的结果
        const { error: upsertError } = await supabase
          .from("ai_match")
          .update({
            crop_image: cropImage,
            category_id: category,
            stored_url: imageUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("source_table", SOURCE_TABLE)
          .eq("source_id", sourceId)
          .eq("image_index", position)
          .is("standard_product_id", null);  // ← 只更新未匹配的记录

        if (upsertError) {
          failed++;
          console.error("[consume-ecommerce-subject-tasks] insert/update ai_match failed", taskId, upsertError.message);
          continue;
        }
      }

      success++;
      console.log("[consume-ecommerce-subject-tasks] task done", taskId, "crop_image =", cropImage ? cropImage.slice(0, 50) + "..." : null, "category =", category);
    }

    console.log("[consume-ecommerce-subject-tasks] done: processed =", tasks.length, "success =", success, "failed =", failed, "noDetection =", noDetection, "skipped =", skipped);

    return jsonResponse({
      ok: true,
      processed: tasks.length,
      success,
      failed,
      noDetection,
      skipped,
      detectionEnabled: enableDetection,
    });
  } catch (e) {
    console.error("[consume-ecommerce-subject-tasks] error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
