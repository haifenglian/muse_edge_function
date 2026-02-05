/**
 * Edge Function 接口：从 Cube dws_standard_products_tag_view 增量同步到 Supabase
 * 逻辑与 sync_cube_to_supabase.py 一致，可作为 HTTP API 触发同步。
 * 日志：Dashboard → Edge Functions → 本函数 → Logs 标签（非 Invocations）
 *
 * 需配置 Secrets：CUBE_BASE_URL, CUBE_API_SECRET（可选，有默认）
 * 可选：CUBE_PAGE_SIZE（默认 5000）, CUBE_MAX_ROWS
 *
 * 接口：
 *   GET  /functions/v1/sync-cube-to-supabase
 *        返回当前同步状态（last_analyzed_at），不执行同步。
 *   POST /functions/v1/sync-cube-to-supabase
 *        触发一次增量同步。可选查询参数：?page_size=5000&max_rows=10000
 *        覆盖环境变量，用于单次限流或测试。
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CUBE_VIEW = "dws_standard_products_tag_view";
const PREFIX = `${CUBE_VIEW}.`;
const VIEW_DIMENSIONS = [
  `${CUBE_VIEW}.id`,
  `${CUBE_VIEW}.category_id`,
  `${CUBE_VIEW}.dimensions_str`,
  `${CUBE_VIEW}.category_tagged_time`,
  `${CUBE_VIEW}.dimensions_tagged_time`,
  `${CUBE_VIEW}.ingested_at`,
  `${CUBE_VIEW}.analyzed_at`,
  `${CUBE_VIEW}.stored_url`,
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function get(row: Record<string, unknown>, key: string): unknown {
  return row[PREFIX + key] ?? row[key];
}

/** stored_url 为字符串类型 URL，转为 [url] 以兼容下游（产品表 resaved_image_path 为数组） */
function parseStoredUrl(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string" && v.trim()) return [v.trim()];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s?.trim());
  return [];
}

function rowToProduct(row: Record<string, unknown>): Record<string, unknown> {
  const rawId = get(row, "id");
  const storedUrl = get(row, "stored_url");
  const rawCat = get(row, "category_id");
  let categoryId: number | null = null;
  if (typeof rawCat === "number" && !Number.isNaN(rawCat)) categoryId = Math.floor(rawCat);
  let dimensionsStr: string = "{}";
  const dims = get(row, "dimensions_str");
  if (dims != null) dimensionsStr = typeof dims === "string" ? dims : JSON.stringify(dims);
  return {
    id: rawId != null ? String(rawId) : null,
    category_id: categoryId,
    dimensions_str: dimensionsStr,
    category_tagged_time: get(row, "category_tagged_time"),
    dimensions_tagged_time: get(row, "dimensions_tagged_time"),
    ingested_at: get(row, "ingested_at"),
    resaved_image_path: parseStoredUrl(storedUrl),
  };
}

function expandTasks(
  productId: string,
  dimensionsStr: string,
  resavedImagePath: string[]
): Array<Record<string, unknown>> {
  const tasks: Array<Record<string, unknown>> = [];
  resavedImagePath.forEach((url, i) => {
    if (!url?.trim()) return;
    tasks.push({
      product_id: productId,
      pic_url: url.trim(),
      pic_name: `${productId}_${i}`,
      custom_content: dimensionsStr,
      status: "pending",
    });
  });
  return tasks;
}

async function makeCubeToken(secret: string, ttlSeconds = 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + ttlSeconds };
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const b64 = (s: string) => btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = b64(JSON.stringify(payload));
  const toSign = `${header}.${payloadB64}`;
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(toSign));
  const sigB64 = b64(String.fromCharCode(...new Uint8Array(sig)));
  return `${header}.${payloadB64}.${sigB64}`;
}

async function fetchCubeIncremental(
  baseUrl: string,
  token: string,
  sinceAnalyzedAt: string | null,
  pageSize: number,
  maxRows: number | null
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const url = `${baseUrl.replace(/\/$/, "")}/load`;
  for (;;) {
    let limit = pageSize;
    if (maxRows != null) {
      const remaining = maxRows - all.length;
      if (remaining <= 0) break;
      limit = Math.min(limit, remaining);
    }
    const query: Record<string, unknown> = {
      dimensions: VIEW_DIMENSIONS,
      limit,
      offset,
      timezone: "UTC",
      order: { [`${CUBE_VIEW}.analyzed_at`]: "asc" },
      filters: [
        { member: `${CUBE_VIEW}.dimensions_str`, operator: "set" },
        { member: `${CUBE_VIEW}.stored_url`, operator: "set" },
      ],
    };
    if (sinceAnalyzedAt) {
      (query.filters as Record<string, unknown>[]).push({
        member: `${CUBE_VIEW}.analyzed_at`,
        operator: "gt",
        values: [sinceAnalyzedAt],
      });
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cube API ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { data?: Record<string, unknown>[] };
    const rows = data.data ?? [];
    all.push(...rows);
    if (rows.length < limit) break;
    offset += rows.length;
    if (maxRows != null && all.length >= maxRows) break;
  }
  return all;
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
  console.log(JSON.stringify({ msg: "sync-cube invoked", method: req.method, path: pathname }));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const cursorKey = "cube_last_analyzed_at";
    const { data: cursorRows } = await supabase.from("sync_state").select("value").eq("key", cursorKey).limit(1);
    const lastAnalyzedAt = (cursorRows?.[0]?.value as string | null) ?? null;

    // GET：仅返回同步状态，不执行同步
    if (req.method === "GET") {
      console.log("[sync-cube] GET: last_analyzed_at =", lastAnalyzedAt ?? "(none)");
      return jsonResponse({
        ok: true,
        cursor_key: cursorKey,
        last_analyzed_at: lastAnalyzedAt,
        message: "使用 POST 触发一次增量同步。",
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "仅支持 GET 与 POST" }, 405);
    }

    // 从 URL 查询参数覆盖环境变量（便于单次限流或测试）
    const url = new URL(req.url);
    const pageSizeParam = url.searchParams.get("page_size");
    const maxRowsParam = url.searchParams.get("max_rows");
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : parseInt(Deno.env.get("CUBE_PAGE_SIZE") ?? "5000", 10);
    const maxRowsEnv = maxRowsParam ?? Deno.env.get("CUBE_MAX_ROWS");
    const maxRows = maxRowsEnv ? parseInt(String(maxRowsEnv), 10) : null;

    const cubeBase = Deno.env.get("CUBE_BASE_URL") ?? "https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1";
    const cubeSecret = Deno.env.get("CUBE_API_SECRET") ?? "032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061";
    const token = await makeCubeToken(cubeSecret);
    console.log("[sync-cube] POST: sync started, last_analyzed_at =", lastAnalyzedAt ?? "(full)", "page_size =", pageSize, "max_rows =", maxRows ?? "none");

    const rows = await fetchCubeIncremental(cubeBase, token, lastAnalyzedAt, pageSize, maxRows);
    if (rows.length === 0) {
      console.log("[sync-cube] no new data from Cube");
      return jsonResponse({
        ok: true,
        message: "本批无新数据",
        products: 0,
        tasksInserted: 0,
        last_analyzed_at: lastAnalyzedAt,
      });
    }

    const products: Record<string, unknown>[] = [];
    const allTasks: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const rawId = get(row, "id");
      if (rawId == null) continue;
      const urls = parseStoredUrl(get(row, "stored_url"));
      if (urls.length === 0) continue; // 仅同步有 stored_url 的产品
      const productId = String(rawId);
      products.push(rowToProduct(row));
      const dimsStr = (get(row, "dimensions_str") != null && typeof get(row, "dimensions_str") === "string")
        ? (get(row, "dimensions_str") as string)
        : "{}";
      allTasks.push(...expandTasks(productId, dimsStr, urls));
    }
    console.log("[sync-cube] fetched from Cube: rows =", rows.length, "products =", products.length, "tasks =", allTasks.length);

    const BATCH = 200;
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH);
      await supabase.from("standard_products_tag").upsert(batch, { onConflict: "id" });
    }

    let inserted = 0;
    for (const t of allTasks) {
      const { error } = await supabase.from("aliyun_sync_tasks").insert(t);
      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message)) continue;
        console.error("task insert error", t.product_id, t.pic_name, error.message);
      } else inserted++;
    }

    const analyzedValues = rows.map((r) => get(r, "analyzed_at")).filter((v): v is string => typeof v === "string");
    const newCursor = analyzedValues.length > 0 ? analyzedValues.sort().pop()! : lastAnalyzedAt;
    if (newCursor) {
      await supabase.from("sync_state").upsert(
        { key: cursorKey, value: newCursor, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      console.log("[sync-cube] cursor updated to", newCursor);
    }
    console.log("[sync-cube] done: products =", products.length, "tasksInserted =", inserted, "tasksTotal =", allTasks.length);

    return jsonResponse({
      ok: true,
      products: products.length,
      tasksInserted: inserted,
      tasksTotal: allTasks.length,
      cursor: newCursor,
      last_analyzed_at: newCursor,
    });
  } catch (e) {
    console.error("[sync-cube] error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
