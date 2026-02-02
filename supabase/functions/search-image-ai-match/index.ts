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
  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: SEARCH_IMAGE_QUERY, variables: { input } }),
  });
  if (!res.ok) {
    return { success: false, productId: null, score: 0, message: `HTTP ${res.status}: ${await res.text()}` };
  }
  const json = (await res.json()) as { data?: SearchImageResult; errors?: unknown[] };
  if (json.errors?.length) {
    return { success: false, productId: null, score: 0, message: JSON.stringify(json.errors) };
  }
  const searchImage = json.data?.ali?.searchImage;
  if (!searchImage) {
    return { success: false, productId: null, score: 0, message: "No searchImage in response" };
  }
  if (!searchImage.Success) {
    return { success: false, productId: null, score: 0, message: "SearchImage Success=false" };
  }
  const auctions = searchImage.Auctions ?? [];
  if (auctions.length === 0) {
    return { success: true, productId: null, score: 0, message: "no_match", noMatch: true };
  }
  const top = auctions[0];
  if (!top || top.ProductId == null || top.ProductId === "") {
    return { success: true, productId: null, score: 0, message: "no_match", noMatch: true };
  }
  const score = typeof top.Score === "number" ? Math.max(0, Math.min(1, top.Score)) : 0;
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

    const NO_MATCH_RETRY_HOURS = 1;
    const retryAfter = new Date(Date.now() - NO_MATCH_RETRY_HOURS * 60 * 60 * 1000).toISOString();

    // GET：仅返回待匹配数量（含「未搜过或距上次 no match 超过 1 小时」）
    if (req.method === "GET") {
      const { count, error } = await supabase
        .from("ai_match")
        .select("id", { count: "exact", head: true })
        .not("crop_image", "is", null)
        .is("standard_product_id", null)
        .or(`last_search_at.is.null,last_search_at.lt.${retryAfter}`);
      if (error) return jsonResponse({ ok: false, error: error.message }, 500);
      return jsonResponse({
        ok: true,
        pending: count ?? 0,
        message: "POST 触发一次图搜匹配（按 5 QPS 调用 SearchImage）；no match 行 1 小时内不再重试",
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "仅支持 GET 与 POST" }, 405);
    }

    const { data: rows, error: fetchError } = await supabase
      .from("ai_match")
      .select("id, crop_image, category_id")
      .not("crop_image", "is", null)
      .is("standard_product_id", null)
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
      const categoryId =
        row.category_id != null && row.category_id !== ""
          ? parseInt(String(row.category_id), 10)
          : undefined;
      const picUrl = row.crop_image ?? "";
      const picUrlShort = picUrl.length > 80 ? picUrl.slice(0, 77) + "..." : picUrl;
      console.log(
        "[search-image-ai-match] task",
        i + 1,
        "/",
        rows.length,
        "id =",
        row.id,
        "category_id =",
        row.category_id ?? "(all)",
        "picUrl =",
        picUrlShort
      );

      const input: SearchImageInput = {
        instanceName,
        picUrl: row.crop_image!,
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
          .update({ standard_product_id: productId, confidence: score })
          .eq("id", row.id);
        if (error) {
          failed++;
          console.error("[search-image-ai-match] update failed", row.id, error.message);
        } else {
          matched++;
          console.log("[search-image-ai-match] row updated", row.id, "-> standard_product_id =", productId, "confidence =", score);
        }
      } else if (success && isNoMatch) {
        noMatch++;
        const now = new Date().toISOString();
        await supabase.from("ai_match").update({ last_search_at: now }).eq("id", row.id);
        console.log("[search-image-ai-match] no match (图库无结果或未入图)，已写 last_search_at，1 小时内不再重试", row.id);
      } else {
        failed++;
        console.error("[search-image-ai-match] search failed", row.id, message || "unknown");
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
