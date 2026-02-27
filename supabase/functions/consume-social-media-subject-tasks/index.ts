/**
 * Edge Function：消费社媒主体识别任务
 *
 * 调用主体识别 API 对 pending 状态的图片进行检测，
 * 识别成功后更新任务状态并写入 ai_match 表供后续图搜。
 *
 * 支持多目标检测：同一图片可检测到多个主体，每个主体生成一条 ai_match 记录
 *
 * 需配置 Secrets：SUBJECT_DETECTION_API_URL（可选，有默认）
 * 可选：BATCH_SIZE（默认 10）
 * 可选：ENABLE_SUBJECT_DETECTION（是否启用主体识别，默认 true）
 *
 * 接口：
 *   GET  /functions/v1/consume-social-media-subject-tasks
 *        返回当前 pending 数量，不执行识别。
 *   POST /functions/v1/consume-social-media-subject-tasks
 *        触发一次批量识别。可选查询参数：?batch_size=10
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const SOURCE_TABLE = "ods_social_media";

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
  console.log(JSON.stringify({ msg: "consume-social-media-subject-tasks invoked", method: req.method, path: pathname }));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // GET：返回 pending 数量
    if (req.method === "GET") {
      const { count, error } = await supabase
        .from("social_media_subject_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) return jsonResponse({ ok: false, error: error.message }, 500);

      const enableDetection = Deno.env.get("ENABLE_SUBJECT_DETECTION") !== "false"; // 默认启用

      return jsonResponse({
        ok: true,
        pending: count ?? 0,
        detectionEnabled: enableDetection,
        message: enableDetection
          ? "使用 POST 触发一次批量主体识别（裁剪图片）。"
          : "主体识别已关闭。设置 ENABLE_SUBJECT_DETECTION=true 启用裁剪。",
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

    // 主体识别开关：默认启用
    const enableDetection = Deno.env.get("ENABLE_SUBJECT_DETECTION") !== "false";

    console.log("[consume-social-media-subject-tasks] POST: consuming tasks, batch_size =", batchSize, "enable_detection =", enableDetection, "detection_api_url =", detectionApiUrl);

    // 拉取 pending 任务
    const { data: tasks, error: fetchError } = await supabase
      .from("social_media_subject_tasks")
      .select("*")
      .eq("status", "pending")
      .limit(batchSize);

    if (fetchError) {
      return jsonResponse({ ok: false, error: fetchError.message }, 500);
    }

    if (!tasks?.length) {
      console.log("[consume-social-media-subject-tasks] no pending tasks");
      return jsonResponse({
        ok: true,
        processed: 0,
        success: 0,
        failed: 0,
        noDetection: 0,
        totalDetections: 0,
        detectionEnabled: enableDetection,
      });
    }

    console.log("[consume-social-media-subject-tasks] fetched", tasks.length, "pending tasks");

    let success = 0;
    let failed = 0;
    let noDetection = 0;
    let totalDetections = 0; // 所有检测到的主体总数

    for (const task of tasks) {
      const taskId = task.id;
      const sourceId = task.source_id;
      const sourceName = task.source_name;
      const imageUrl = task.image_url;
      const position = task.position;

      console.log("[consume-social-media-subject-tasks] processing task", taskId, "source_id =", sourceId, "position =", position, "image_url =", imageUrl);

      // 社媒默认启用主体识别
      if (!enableDetection) {
        // 如果关闭了主体识别，跳过此任务
        failed++;
        await supabase
          .from("social_media_subject_tasks")
          .update({ status: "failed", error_message: "主体识别未启用", updated_at: new Date().toISOString() })
          .eq("id", taskId);
        console.log("[consume-social-media-subject-tasks] detection disabled, skipping", taskId);
        continue;
      }

      // 调用主体识别 API
      const result = await callSubjectDetection(detectionApiUrl, imageUrl);

      if (!result.success) {
        failed++;
        await supabase
          .from("social_media_subject_tasks")
          .update({ status: "failed", error_message: result.error, updated_at: new Date().toISOString() })
          .eq("id", taskId);
        console.error("[consume-social-media-subject-tasks] detection failed", taskId, result.error);
        continue;
      }

      const detections = result.detections;

      if (detections.length === 0) {
        // 未检测到主体，标记为失败
        noDetection++;
        await supabase
          .from("social_media_subject_tasks")
          .update({ status: "failed", error_message: "未检测到主体", updated_at: new Date().toISOString() })
          .eq("id", taskId);
        console.log("[consume-social-media-subject-tasks] no detection", taskId);
        continue;
      }

      // 更新任务状态为 done，记录第一个检测结果的类别
      const firstDetection = detections[0];
      const { error: updateError } = await supabase
        .from("social_media_subject_tasks")
        .update({
          status: "done",
          crop_image: firstDetection.gcs_url,
          category_id: firstDetection.category,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      if (updateError) {
        failed++;
        console.error("[consume-social-media-subject-tasks] update task failed", taskId, updateError.message);
        continue;
      }

      // 写入 ai_match 表 - 每个检测结果一条记录
      for (let detectionIndex = 0; detectionIndex < detections.length; detectionIndex++) {
        const detection = detections[detectionIndex];
        const cropImage = detection.gcs_url;
        const category = detection.category;

        const aiMatchData = {
          crop_image: cropImage,
          category_id: category,
          standard_product_id: null, // 待图搜匹配
          confidence: 0,
          source_table: SOURCE_TABLE,
          source_id: sourceId,
          source_name: sourceName,
          image_index: position,
          detection_index: detectionIndex,
          stored_url: imageUrl,
        };

        // 使用 upsert，避免重复插入
        // onConflict 使用列名（PostgreSQL 会自动找到对应的唯一约束）
        const { error: upsertError } = await supabase
          .from("ai_match")
          .upsert(aiMatchData, {
            onConflict: "source_table,source_id,image_index,detection_index",
          })
          .is("standard_product_id", null);  // ← 只更新未匹配的记录，保护已匹配结果

        if (upsertError) {
          // 检查是否是"已匹配"导致的更新失败（可以忽略）
          if (upsertError.message.includes("source_table, source_id, image_index, detection_index")) {
            console.log("[consume-social-media-subject-tasks] ai_match already exists and matched, skipping", taskId, "detection_index =", detectionIndex);
          } else {
            console.error("[consume-social-media-subject-tasks] upsert ai_match failed", taskId, "detection_index =", detectionIndex, upsertError.message);
          }
          // 不把整个任务标记为失败，因为其他检测结果可能成功
          continue;
        }

        totalDetections++;
        console.log("[consume-social-media-subject-tasks] ai_match upserted", taskId, "detection_index =", detectionIndex, "category =", category);
      }

      success++;
      console.log("[consume-social-media-subject-tasks] task done", taskId, "detections =", detections.length);
    }

    console.log("[consume-social-media-subject-tasks] done: processed =", tasks.length, "success =", success, "failed =", failed, "noDetection =", noDetection, "totalDetections =", totalDetections);

    return jsonResponse({
      ok: true,
      processed: tasks.length,
      success,
      failed,
      noDetection,
      totalDetections,
      detectionEnabled: enableDetection,
    });
  } catch (e) {
    console.error("[consume-social-media-subject-tasks] error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
