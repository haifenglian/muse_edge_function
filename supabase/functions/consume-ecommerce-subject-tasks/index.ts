/**
 * Edge Function：消费电商主体识别任务
 *
 * 调用主体识别 API 对 pending 状态的图片进行检测，
 * 识别成功后更新任务状态并写入 ai_match 表供后续图搜。
 *
 * 需配置 Secrets：SUBJECT_DETECTION_API_URL（可选，有默认）
 * 可选：BATCH_SIZE（默认 10）
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
      return jsonResponse({
        ok: true,
        pending: count ?? 0,
        message: "使用 POST 触发一次批量主体识别。",
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

    console.log("[consume-ecommerce-subject-tasks] POST: consuming tasks, batch_size =", batchSize, "api_url =", detectionApiUrl);

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
      });
    }

    console.log("[consume-ecommerce-subject-tasks] fetched", tasks.length, "pending tasks");

    let success = 0;
    let failed = 0;
    let noDetection = 0;

    for (const task of tasks) {
      const taskId = task.id;
      const imageUrl = task.image_url;
      const productId = task.product_id;
      const productName = task.product_name;
      const position = task.position;

      console.log("[consume-ecommerce-subject-tasks] processing task", taskId, "product_id =", productId, "position =", position, "image_url =", imageUrl);

      // 调用主体识别 API
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
      const gcsUrl = firstDetection.gcs_url;
      const category = firstDetection.category;

      // 更新任务状态为 done
      const { error: updateError } = await supabase
        .from("ecommerce_subject_tasks")
        .update({
          status: "done",
          crop_image: gcsUrl,
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
        crop_image: gcsUrl,
        category_id: category,
        standard_product_id: null, // 待图搜匹配
        confidence: 0,
        source_table: SOURCE_TABLE,
        source_id: productId,
        source_name: productName,
        image_index: position,
      };

      const { error: insertError } = await supabase
        .from("ai_match")
        .insert(aiMatchData);

      if (insertError) {
        // 如果是唯一约束冲突，尝试更新
        const { error: upsertError } = await supabase
          .from("ai_match")
          .update({
            crop_image: gcsUrl,
            category_id: category,
            updated_at: new Date().toISOString(),
          })
          .eq("source_table", SOURCE_TABLE)
          .eq("source_id", productId)
          .eq("image_index", position);

        if (upsertError) {
          failed++;
          console.error("[consume-ecommerce-subject-tasks] insert/update ai_match failed", taskId, upsertError.message);
          continue;
        }
      }

      success++;
      console.log("[consume-ecommerce-subject-tasks] task done", taskId, "gcs_url =", gcsUrl, "category =", category);
    }

    console.log("[consume-ecommerce-subject-tasks] done: processed =", tasks.length, "success =", success, "failed =", failed, "noDetection =", noDetection);

    return jsonResponse({
      ok: true,
      processed: tasks.length,
      success,
      failed,
      noDetection,
    });
  } catch (e) {
    console.error("[consume-ecommerce-subject-tasks] error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
