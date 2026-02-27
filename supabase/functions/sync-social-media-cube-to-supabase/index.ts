/**
 * Edge Function：从 Cube dwd_social_media_data_view 增量同步到 Supabase social_media_subject_tasks
 *
 * 需配置 Secrets：CUBE_BASE_URL, CUBE_API_SECRET（可选，有默认）
 * 可选：CUBE_PAGE_SIZE（默认 5000）, CUBE_MAX_ROWS（默认 2000，防止 Edge Function 超时）
 *
 * 接口：
 *   GET  /functions/v1/sync-social-media-cube-to-supabase
 *        返回当前同步状态（last_updated_at），不执行同步。
 *   POST /functions/v1/sync-social-media-cube-to-supabase
 *        触发一次增量同步。可选查询参数：?page_size=5000&max_rows=2000
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CUBE_VIEW = "dwd_social_media_data_view";
const PREFIX = `${CUBE_VIEW}.`;
const VIEW_DIMENSIONS = [
  // 来自 dwd_social_media_data
  `${CUBE_VIEW}.id`,
  `${CUBE_VIEW}.source_name`,
  `${CUBE_VIEW}.platform`,
  `${CUBE_VIEW}.account_type`,
  `${CUBE_VIEW}.text_content`,
  `${CUBE_VIEW}.source_url`,
  `${CUBE_VIEW}.publish_time`,
  `${CUBE_VIEW}.fetch_time`,
  // 来自 dwd_media_asset_storage_mapping
  `${CUBE_VIEW}.stored_url`,
  `${CUBE_VIEW}.origin_url`,
  `${CUBE_VIEW}.position`,
  `${CUBE_VIEW}.status`,
  `${CUBE_VIEW}.updated_at`,
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function get(row: Record<string, unknown>, key: string): unknown {
  return row[PREFIX + key] ?? row[key];
}

function rowToTask(row: Record<string, unknown>): Record<string, unknown> | null {
  // 来自 dwd_social_media_data
  const id = get(row, "id");
  const sourceName = get(row, "source_name");
  const platform = get(row, "platform");
  const accountType = get(row, "account_type");
  const textContent = get(row, "text_content");
  const sourceUrl = get(row, "source_url");
  const publishTime = get(row, "publish_time");
  const fetchTime = get(row, "fetch_time");
  // 来自 dwd_media_asset_storage_mapping
  const storedUrl = get(row, "stored_url");
  const originUrl = get(row, "origin_url");
  const position = get(row, "position");

  if (id == null || storedUrl == null || (typeof storedUrl === "string" && !storedUrl.trim())) {
    return null;
  }
  const url = typeof storedUrl === "string" ? storedUrl.trim() : String(storedUrl);
  if (!url) return null;

  const pos = typeof position === "number" && !Number.isNaN(position) ? Math.floor(position) : 0;
  return {
    source_id: String(id),
    source_name: sourceName != null ? String(sourceName) : null,
    image_url: url,
    position: pos,
    origin_url: originUrl != null ? String(originUrl) : null,
    platform: platform != null ? String(platform) : null,
    account_type: accountType != null ? String(accountType) : null,
    text_content: textContent != null ? String(textContent) : null,
    source_url: sourceUrl != null ? String(sourceUrl) : null,
    publish_time: publishTime != null ? String(publishTime) : null,
    fetch_time: fetchTime != null ? String(fetchTime) : null,
    status: "pending",
  };
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

async function fetchCubeSocialMediaIncremental(
  baseUrl: string,
  token: string,
  sinceUpdatedAt: string | null,
  pageSize: number,
  maxRows: number | null
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const loadUrl = `${baseUrl.replace(/\/$/, "")}/load`;

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
      order: { [`${CUBE_VIEW}.updated_at`]: "asc" },
      filters: [
        { member: `${CUBE_VIEW}.stored_url`, operator: "set" },
        { member: `${CUBE_VIEW}.status`, operator: "equals", values: ["success"] },
      ],
    };
    if (sinceUpdatedAt) {
      (query.filters as Record<string, unknown>[]).push({
        member: `${CUBE_VIEW}.updated_at`,
        operator: "gt",
        values: [sinceUpdatedAt],
      });
    }

    // 优先使用 GET + query 参数（Cube Cloud 可能要求 query 在 URL）
    const queryStr = encodeURIComponent(JSON.stringify(query));
    let res = await fetch(`${loadUrl}?query=${queryStr}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok && res.status === 400) {
      const errText = await res.text();
      if (/query param|query param is required/i.test(errText)) {
        res = await fetch(loadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
      } else {
        throw new Error(`Cube API 400: ${errText}`);
      }
    }
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
  console.log(JSON.stringify({ msg: "sync-social-media-cube invoked", method: req.method, path: pathname }));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const cursorKey = "cube_social_media_last_updated_at";
    const { data: cursorRows } = await supabase.from("sync_state").select("value").eq("key", cursorKey).limit(1);
    const lastUpdatedAt = (cursorRows?.[0]?.value as string | null) ?? null;

    if (req.method === "GET") {
      console.log("[sync-social-media-cube] GET: last_updated_at =", lastUpdatedAt ?? "(none)");
      return jsonResponse({
        ok: true,
        cursor_key: cursorKey,
        last_updated_at: lastUpdatedAt,
        message: "使用 POST 触发一次增量同步。",
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "仅支持 GET 与 POST" }, 405);
    }

    const url = new URL(req.url);
    const pageSizeParam = url.searchParams.get("page_size");
    const maxRowsParam = url.searchParams.get("max_rows");
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : parseInt(Deno.env.get("CUBE_PAGE_SIZE") ?? "5000", 10);
    const maxRowsEnv = maxRowsParam ?? Deno.env.get("CUBE_MAX_ROWS") ?? "2000";
    const maxRows = maxRowsEnv ? parseInt(String(maxRowsEnv), 10) : null;

    const cubeBase = Deno.env.get("CUBE_BASE_URL") ?? "https://combative-keene.gcp-us-central1.cubecloudapp.dev/cubejs-api/v1";
    const cubeSecret = Deno.env.get("CUBE_API_SECRET") ?? "032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061";
    const token = await makeCubeToken(cubeSecret);
    console.log("[sync-social-media-cube] POST: sync started, last_updated_at =", lastUpdatedAt ?? "(full)", "page_size =", pageSize, "max_rows =", maxRows ?? "none");

    const rows = await fetchCubeSocialMediaIncremental(cubeBase, token, lastUpdatedAt, pageSize, maxRows);

    if (rows.length === 0) {
      console.log("[sync-social-media-cube] no new data from Cube");
      return jsonResponse({
        ok: true,
        message: "本批无新数据",
        tasksInserted: 0,
        last_updated_at: lastUpdatedAt,
      });
    }

    const tasks: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const task = rowToTask(row);
      if (task) tasks.push(task);
    }

    console.log("[sync-social-media-cube] fetched from Cube: rows =", rows.length, "tasks =", tasks.length);

    const { error: upsertError } = await supabase.from("social_media_subject_tasks").upsert(tasks, {
      onConflict: "source_id,position",
      ignoreDuplicates: true,
    });
    if (upsertError) {
      throw new Error(`social_media_subject_tasks upsert failed: ${upsertError.message}`);
    }
    const inserted = tasks.length;

    const updatedValues = rows.map((r) => get(r, "updated_at")).filter((v): v is string => typeof v === "string");
    const newCursor = updatedValues.length > 0 ? updatedValues.sort().pop()! : lastUpdatedAt;

    if (newCursor) {
      await supabase.from("sync_state").upsert(
        { key: cursorKey, value: newCursor, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      console.log("[sync-social-media-cube] cursor updated to", newCursor);
    }

    console.log("[sync-social-media-cube] done: tasksInserted =", inserted, "tasksTotal =", tasks.length);

    return jsonResponse({
      ok: true,
      tasksInserted: inserted,
      tasksTotal: tasks.length,
      cursor: newCursor,
      last_updated_at: newCursor,
    });
  } catch (e) {
    console.error("[sync-social-media-cube] error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
