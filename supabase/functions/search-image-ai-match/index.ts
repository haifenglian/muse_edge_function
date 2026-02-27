/**
 * 图搜-商品匹配：对 ai_match 表中 crop_image 非空且 standard_product_id 为空的记录，
 * 调用阿里云 SearchImage，将最高分结果的 ProductId/Score 回写到 standard_product_id/confidence。
 *
 * 鉴权：HASURA_API_TOKEN（与 consume-aliyun-sync-tasks 一致）
 * 可选：ALIYUN_GRAPHQL_URL、INSTANCE_NAME、BATCH_SIZE、SCORE_THRESHOLD
 *
 * GET：返回待匹配数量（不执行）
 * POST：拉取一批待匹配行，按 5 QPS 调 SearchImage 并回写
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const QPS = 5;
const DELAY_MS = 1000 / QPS;

const SEARCH_IMAGE_QUERY = `
mutation SearchImage($input: SearchImageInput!) {
  ali { searchImage(input: $input) {
    PicInfo { CategoryId Region }
    Auctions { CategoryId CustomContent IntAttr PicName ProductId Score }
    RequestId Success
  }}
}
`;

type SearchImageInput = {
  instanceName: string;
  picUrl: string;
  num: number;
  start: number;
  scoreThreshold?: string;
  categoryId?: number;
};

type SearchImageResult = {
  ali?: {
    searchImage?: {
      Success?: boolean;
      RequestId?: string;
      Auctions?: Array<{ ProductId?: string; Score?: number; PicName?: string; CustomContent?: string; CategoryId?: number }>;
      PicInfo?: { CategoryId?: number; Region?: string };
    };
  };
};

async function callSearchImage(
  graphqlUrl: string,
  token: string,
  input: SearchImageInput
): Promise<{ success: boolean; productId: string | null; score: number; message: string; noMatch?: boolean }> {
  console.log("[search-image-ai-match] SearchImage request:", JSON.stringify({
    instanceName: input.instanceName,
    picUrl: input.picUrl.length > 100 ? input.picUrl.slice(0, 97) + "..." : input.picUrl,
    num: input.num,
    start: input.start,
    scoreThreshold: input.scoreThreshold,
    categoryId: input.categoryId,
  }));

  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: SEARCH_IMAGE_QUERY, variables: { input } }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error("[search-image-ai-match] SearchImage HTTP error:", res.status, errorText);
    return { success: false, productId: null, score: 0, message: `HTTP ${res.status}: ${errorText}` };
  }
  const json = (await res.json()) as { data?: SearchImageResult; errors?: unknown[] };
  console.log("[search-image-ai-match] SearchImage response:", JSON.stringify(json));

  if (json.errors?.length) {
    console.error("[search-image-ai-match] SearchImage GraphQL errors:", JSON.stringify(json.errors));
    return { success: false, productId: null, score: 0, message: JSON.stringify(json.errors) };
  }
  const searchImage = json.data?.ali?.searchImage;
  if (!searchImage) {
    console.error("[search-image-ai-match] SearchImage no searchImage in response, data:", JSON.stringify(json.data));
    return { success: false, productId: null, score: 0, message: "No searchImage in response" };
  }
  if (!searchImage.Success) {
    console.error("[search-image-ai-match] SearchImage Success=false, searchImage:", JSON.stringify(searchImage));
    return { success: false, productId: null, score: 0, message: "SearchImage Success=false" };
  }

  const auctions = searchImage.Auctions ?? [];
  console.log("[search-image-ai-match] SearchImage auctions count:", auctions.length);

  if (auctions.length === 0) {
    console.log("[search-image-ai-match] SearchImage no auctions (no match), PicInfo:", JSON.stringify(searchImage.PicInfo));
    return { success: true, productId: null, score: 0, message: "no_match", noMatch: true };
  }

  const top = auctions[0];
  console.log("[search-image-ai-match] SearchImage top result:", JSON.stringify(top));

  if (!top || top.ProductId == null || top.ProductId === "") {
    console.log("[search-image-ai-match] SearchImage top result has no ProductId");
    return { success: true, productId: null, score: 0, message: "no_match", noMatch: true };
  }

  const score = typeof top.Score === "number" ? Math.max(0, Math.min(1, top.Score)) : 0;
  console.log("[search-image-ai-match] SearchImage matched: ProductId =", top.ProductId, "Score =", score);
  return { success: true, productId: String(top.ProductId), score, message: "" };
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

  console.log(JSON.stringify({ msg: "search-image-ai-match invoked", method: req.method }));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = Deno.env.get("HASURA_API_TOKEN") ?? Deno.env.get("HASURA_ACCESS_TOKEN");
    if (!token?.trim()) {
      return jsonResponse({ ok: false, error: "HASURA_API_TOKEN 未配置" }, 500);
    }
    const graphqlUrl = (Deno.env.get("ALIYUN_GRAPHQL_URL") ?? "https://hasura-auth-worker.data-d1a.workers.dev/").replace(/\/$/, "");
    const instanceName = Deno.env.get("INSTANCE_NAME") ?? "muse";
    const batchSize = Math.min(50, Math.max(1, parseInt(Deno.env.get("BATCH_SIZE") ?? "25", 10)));
    const scoreThreshold = Deno.env.get("SCORE_THRESHOLD") ?? "0.0";
    const maxRetries = parseInt(Deno.env.get("MAX_SEARCH_RETRIES") ?? "3", 10);

    const NO_MATCH_RETRY_HOURS = 1;
    const retryAfter = new Date(Date.now() - NO_MATCH_RETRY_HOURS * 60 * 60 * 1000).toISOString();

    // GET：仅返回待匹配数量（含「未搜过或距上次 no match 超过 1 小时」且「重试次数未达上限」）
    if (req.method === "GET") {
      const { count, error } = await supabase
        .from("ai_match")
        .select("id", { count: "exact", head: true })
        .not("crop_image", "is", null)
        .is("standard_product_id", null)
        .lt("search_retry_count", maxRetries)
        .or(`last_search_at.is.null,last_search_at.lt.${retryAfter}`);
      if (error) return jsonResponse({ ok: false, error: error.message }, 500);
      return jsonResponse({
        ok: true,
        pending: count ?? 0,
        maxRetries,
        message: `POST 触发一次图搜匹配（按 5 QPS 调用 SearchImage）；no match 行 1 小时内不再重试；失败行重试 ${maxRetries} 次后不再重试`,
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "仅支持 GET 与 POST" }, 405);
    }

    const { data: rows, error: fetchError } = await supabase
      .from("ai_match")
      .select("id, crop_image, category_id, source_table, stored_url, search_retry_count")
      .not("crop_image", "is", null)
      .is("standard_product_id", null)
      .lt("search_retry_count", maxRetries)
      .or(`last_search_at.is.null,last_search_at.lt.${retryAfter}`)
      .order("create_time", { ascending: true, nullsFirst: false })
      .limit(batchSize);

    if (fetchError) {
      return jsonResponse({ ok: false, error: fetchError.message }, 500);
    }
    if (!rows?.length) {
      console.log("[search-image-ai-match] no pending rows");
      return jsonResponse({ ok: true, processed: 0, matched: 0, noMatch: 0, failed: 0 });
    }

    console.log(
      "[search-image-ai-match] fetched",
      rows.length,
      "rows, ids =",
      rows.map((r) => r.id).join(", ")
    );
    console.log("[search-image-ai-match] processing", rows.length, "rows @ 5 QPS");

    let matched = 0;
    let failed = 0;
    let noMatch = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // 详细打印品类信息
      const rawCategoryId = row.category_id;
      let categoryId: number | undefined;
      let categoryInfo = "";
      if (rawCategoryId != null && rawCategoryId !== "") {
        categoryId = parseInt(String(rawCategoryId), 10);
        categoryInfo = `raw="${rawCategoryId}" parsed=${categoryId}`;
      } else {
        categoryInfo = "undefined (will search all categories)";
      }

      // source_table 为 ods_ecommerce 时使用 stored_url 进行图搜，否则使用 crop_image
      const picUrl = row.source_table === "ods_ecommerce"
        ? (row.stored_url ?? row.crop_image ?? "")
        : (row.crop_image ?? "");
      const picUrlShort = picUrl.length > 80 ? picUrl.slice(0, 77) + "..." : picUrl;
      console.log(
        "[search-image-ai-match] task",
        i + 1,
        "/",
        rows.length,
        "id =",
        row.id,
        "source_table =",
        row.source_table ?? "(null)",
        "category_id =",
        rawCategoryId ?? "(null)",
        `(${categoryInfo})`,
        "picUrl =",
        picUrlShort
      );

      // source_table 为 ods_ecommerce 时使用 stored_url 进行图搜，否则使用 crop_image
      const searchPicUrl = row.source_table === "ods_ecommerce"
        ? (row.stored_url ?? row.crop_image ?? "")
        : (row.crop_image ?? "");

      const input: SearchImageInput = {
        instanceName,
        picUrl: searchPicUrl,
        num: 1,
        start: 0,
        scoreThreshold,
        ...(Number.isInteger(categoryId) ? { categoryId } : {}),
      };
      const result = await callSearchImage(graphqlUrl, token, input);
      const { success, productId, score, message, noMatch: isNoMatch } = result;

      if (success && productId != null && productId !== "") {
        console.log("[search-image-ai-match] SearchImage ok, productId =", productId, "score =", score);
        const { error } = await supabase
          .from("ai_match")
          .update({
            standard_product_id: productId,
            confidence: score,
            search_error_message: null,
          })
          .eq("id", row.id);
        if (error) {
          // 打印完整错误信息用于诊断
          console.error("[search-image-ai-match] update error details:", JSON.stringify(error));
          // 检查是否是唯一键冲突
          if (error.message.includes("unique constraint") || error.message.includes("duplicate key")) {
            // 唯一键冲突：说明相同 source_id 的另一条记录已经匹配到这个产品
            // 更新 last_search_at 和 search_retry_count，避免无限重试
            const now = new Date().toISOString();
            await supabase.from("ai_match").update({
              last_search_at: now,
              search_retry_count: (row.search_retry_count ?? 0) + 1,
              search_error_message: `duplicate: ${error.message}`,
            }).eq("id", row.id);
            console.log("[search-image-ai-match] skip duplicate, 已更新重试信息", row.id);
          } else {
            failed++;
            console.error("[search-image-ai-match] update failed", row.id, error.message);
          }
        } else {
          matched++;
          console.log("[search-image-ai-match] row updated", row.id, "-> standard_product_id =", productId, "confidence =", score);
        }
      } else if (success && isNoMatch) {
        noMatch++;
        const now = new Date().toISOString();
        await supabase.from("ai_match").update({
          last_search_at: now,
          search_retry_count: (row.search_retry_count ?? 0) + 1,
          search_error_message: null,
        }).eq("id", row.id);
        console.log("[search-image-ai-match] no match (图库无结果或未入图)，已写 last_search_at，1 小时内不再重试", row.id);
      } else {
        failed++;
        const now = new Date().toISOString();
        await supabase.from("ai_match").update({
          last_search_at: now,
          search_retry_count: (row.search_retry_count ?? 0) + 1,
          search_error_message: message?.slice(0, 500) || "unknown",
        }).eq("id", row.id);
        console.error("[search-image-ai-match] search failed", row.id, message || "unknown", "已写 last_search_at 和 search_error_message");
      }

      await sleep(DELAY_MS);
    }

    console.log("[search-image-ai-match] done: processed =", rows.length, "matched =", matched, "noMatch =", noMatch, "failed =", failed);
    return jsonResponse({
      ok: true,
      processed: rows.length,
      matched,
      noMatch,
      failed,
    });
  } catch (e) {
    console.error("[search-image-ai-match] error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
