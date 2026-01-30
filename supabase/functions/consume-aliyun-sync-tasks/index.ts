/**
 * 阶段二：消费 aliyun_sync_tasks 中 status=pending 的任务，
 * 按 5 QPS 调用阿里云图搜 Hasura AddImage，并更新任务状态。
 *
 * 需配置 Secrets：
 *   HASURA_API_TOKEN     必填，Hasura worker 的 Bearer token（或 HASURA_ACCESS_TOKEN）
 *   ALIYUN_GRAPHQL_URL   可选，默认 https://hasura-auth-worker.data-d1a.workers.dev/
 *   INSTANCE_NAME        可选，默认 muse
 *   BATCH_SIZE           可选，单次最多处理条数，默认 25（约 5 秒 @ 5 QPS）
 *
 * 调用：POST /functions/v1/consume-aliyun-sync-tasks
 *       GET  返回当前 pending 数量（不执行消费）
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const QPS = 5;
const DELAY_MS = 1000 / QPS;

const ADD_IMAGE_MUTATION = `
mutation AddImage($input: AddImageInput!) {
  ali {
    addImage(input: $input) {
      Success
      Message
      RequestId
      Code
    }
  }
}
`;

type AddImageInput = {
  instanceName: string;
  productId: string;
  picName: string;
  picUrl: string;
  customContent: string | null;
};

type AddImageResult = {
  ali?: {
    addImage?: {
      Success?: boolean;
      Message?: string;
      RequestId?: string;
      Code?: number | string;
    };
  };
};

async function callAddImage(
  graphqlUrl: string,
  token: string,
  input: AddImageInput
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: ADD_IMAGE_MUTATION,
      variables: { input },
    }),
  });
  if (!res.ok) {
    return { success: false, message: `HTTP ${res.status}: ${await res.text()}` };
  }
  const json = (await res.json()) as { data?: AddImageResult; errors?: unknown[] };
  console.log("[consume-aliyun] AddImage raw response:", JSON.stringify(json));
  if (json.errors?.length) {
    return { success: false, message: JSON.stringify(json.errors) };
  }
  const addImage = json.data?.ali?.addImage;
  if (!addImage) {
    return { success: false, message: "No addImage in response: " + JSON.stringify(json.data) };
  }
  const ok =
    addImage.Success === true ||
    addImage.Success === "true" ||
    (typeof addImage.Code === "number" && addImage.Code === 0);
  const msg = addImage.Message ?? "";
  if (!ok && msg) console.error("[consume-aliyun] AddImage failed:", addImage);
  return { success: ok, message: msg };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  console.log(JSON.stringify({ msg: "consume-aliyun invoked", method: req.method }));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = Deno.env.get("HASURA_API_TOKEN") ?? Deno.env.get("HASURA_ACCESS_TOKEN");
    if (!token?.trim()) {
      return jsonResponse({ ok: false, error: "HASURA_API_TOKEN (或 HASURA_ACCESS_TOKEN) 未配置" }, 500);
    }
    const graphqlUrl = (Deno.env.get("ALIYUN_GRAPHQL_URL") ?? "https://hasura-auth-worker.data-d1a.workers.dev/").replace(/\/$/, "");
    const instanceName = Deno.env.get("INSTANCE_NAME") ?? "muse";
    const batchSize = Math.min(100, Math.max(1, parseInt(Deno.env.get("BATCH_SIZE") ?? "25", 10)));

    // GET：仅返回 pending 数量
    if (req.method === "GET") {
      const { count, error } = await supabase
        .from("aliyun_sync_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) return jsonResponse({ ok: false, error: error.message }, 500);
      return jsonResponse({
        ok: true,
        pending: count ?? 0,
        message: "POST 触发一次消费（按 5 QPS 调用 AddImage）",
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "仅支持 GET 与 POST" }, 405);
    }

    const { data: rows, error: fetchError } = await supabase
      .from("aliyun_sync_tasks")
      .select("id, product_id, pic_url, pic_name, custom_content, retry_count, max_retries")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(batchSize * 2);
    if (fetchError) {
      return jsonResponse({ ok: false, error: fetchError.message }, 500);
    }
    const tasks = (rows ?? []).filter((t) => (t.retry_count ?? 0) < (t.max_retries ?? 3)).slice(0, batchSize);

    if (!tasks.length) {
      console.log("[consume-aliyun] no pending tasks");
      return jsonResponse({ ok: true, processed: 0, synced: 0, failed: 0 });
    }

    console.log("[consume-aliyun] processing", tasks.length, "tasks @ 5 QPS");

    let synced = 0;
    let failed = 0;
    const now = new Date().toISOString();
    const PLACEHOLDER_URL_PREFIX = "https://example.com/placeholder/";

    for (const t of tasks) {
      await supabase
        .from("aliyun_sync_tasks")
        .update({ processing_started_at: now })
        .eq("id", t.id);

      const isPlaceholder =
        typeof t.pic_url === "string" && t.pic_url.startsWith(PLACEHOLDER_URL_PREFIX);
      if (isPlaceholder) {
        await supabase
          .from("aliyun_sync_tasks")
          .update({
            status: "failed",
            error_message: "placeholder URL，无真实图片地址，请等 Cube 同步真实 resaved_image_path 后再重试",
            completed_at: now,
            updated_at: now,
          })
          .eq("id", t.id);
        failed++;
        console.log("[consume-aliyun] skip placeholder URL", t.pic_name, t.pic_url);
        await sleep(DELAY_MS);
        continue;
      }

      const input = {
        instanceName,
        productId: t.product_id,
        picName: t.pic_name,
        picUrl: t.pic_url,
        customContent: t.custom_content ?? "",
      };
      console.log("[consume-aliyun] AddImage request:", JSON.stringify(input));
      const { success, message } = await callAddImage(
        graphqlUrl,
        token,
        input
      );

      if (success) {
        await supabase
          .from("aliyun_sync_tasks")
          .update({
            status: "synced",
            synced_at: now,
            completed_at: now,
            error_message: null,
            updated_at: now,
          })
          .eq("id", t.id);
        synced++;
      } else {
        const newRetry = (t.retry_count ?? 0) + 1;
        const maxRetries = t.max_retries ?? 3;
        await supabase
          .from("aliyun_sync_tasks")
          .update({
            retry_count: newRetry,
            error_message: message,
            status: newRetry >= maxRetries ? "failed" : "pending",
            completed_at: newRetry >= maxRetries ? now : null,
            updated_at: now,
          })
          .eq("id", t.id);
        failed++;
        console.error("[consume-aliyun] task failed", t.id, t.pic_name, message);
      }

      await sleep(DELAY_MS);
    }

    console.log("[consume-aliyun] done: processed =", tasks.length, "synced =", synced, "failed =", failed);
    return jsonResponse({
      ok: true,
      processed: tasks.length,
      synced,
      failed,
    });
  } catch (e) {
    console.error("[consume-aliyun] error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
