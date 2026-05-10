import { createHash, randomBytes } from "node:crypto";

const restTimeoutMs = 25_000;
const defaultTenDayTarget = 5000;
const maxScanHistoryRecords = 200;
const maxResultsPerWorkspace = 500;
const addressPattern = /0x[a-fA-F0-9]{40}/g;

export function isSupabaseConfigured(env = process.env) {
  const config = supabaseConfig(env);
  return Boolean(config.url && config.publishableKey && config.secretKey);
}

export function getBearerToken(request) {
  const authorization = headerValue(request.headers, "authorization");
  const direct = headerValue(request.headers, "x-okx-boost-session");
  return authorization.replace(/^Bearer\s+/i, "").trim() || direct.trim();
}

export async function getSupabaseUserFromRequest(request, env = process.env) {
  const token = getBearerToken(request);
  if (!token || !isSupabaseConfigured(env)) return null;
  const user = await getAuthUser(token, env);
  return user ? { token, user } : null;
}

export async function signInWithPassword(input, env = process.env) {
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || "");
  if (!email) throw userError("请填写邮箱。", 400);
  if (!password) throw userError("请填写密码。", 400);

  const payload = await authFetch(env, "/auth/v1/token?grant_type=password", {
    method: "POST",
    apiKey: "publishable",
    body: { email, password },
  });
  return authPayloadToSession(payload);
}

export async function refreshAuthSession(refreshToken, env = process.env) {
  const token = String(refreshToken || "").trim();
  if (!token) throw userError("缺少刷新令牌。", 400);
  const payload = await authFetch(env, "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    apiKey: "publishable",
    body: { refresh_token: token },
  });
  return authPayloadToSession(payload);
}

export async function createInvite(input, env = process.env) {
  ensureSupabaseConfigured(env);
  const code = normalizeInviteCode(input?.code) || generateInviteCode();
  const email = normalizeEmail(input?.email);
  const expiresInDays = clampInteger(input?.expiresInDays, 1, 365, 14);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const [invite] = await restInsert(env, "invites", [
    {
      code_hash: hashInviteCode(code),
      email: email || null,
      role: input?.role === "admin" ? "admin" : "user",
      max_wallets: clampInteger(input?.maxWallets, 1, 200, 20),
      daily_refresh_limit: clampInteger(input?.dailyRefreshLimit, 0, 1000, 50),
      daily_rescan_limit: clampInteger(input?.dailyRescanLimit, 0, 1000, 10),
      expires_at: expiresAt,
    },
  ]);

  return {
    code,
    invite: redactInvite(invite),
  };
}

export async function listInvites(env = process.env) {
  ensureSupabaseConfigured(env);
  const rows = await restSelect(env, "invites", {
    select: "id,email,role,max_wallets,daily_refresh_limit,daily_rescan_limit,expires_at,used_at,used_by,created_at",
    order: "created_at.desc",
    limit: "50",
  });
  return rows.map(redactInvite);
}

export async function revokeInvite(input, env = process.env) {
  ensureSupabaseConfigured(env);
  const inviteId = String(input?.inviteId || input?.id || "").trim();
  if (!isUuid(inviteId)) throw userError("邀请码 ID 无效。", 400);
  const [invite] = await restPatch(
    env,
    "invites",
    { id: `eq.${inviteId}`, used_at: "is.null" },
    { expires_at: new Date().toISOString() },
  );
  if (!invite) throw userError("邀请码不存在或已被使用。", 404);
  return redactInvite(invite);
}

export async function redeemInvite(input, env = process.env) {
  ensureSupabaseConfigured(env);
  const code = normalizeInviteCode(input?.inviteCode || input?.code);
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || "");
  if (!code) throw userError("请填写邀请码。", 400);
  if (!email) throw userError("请填写邮箱。", 400);
  if (password.length < 8) throw userError("密码至少 8 位。", 400);

  const [invite] = await restSelect(env, "invites", {
    code_hash: `eq.${hashInviteCode(code)}`,
    select: "*",
    limit: "1",
  });
  validateInvite(invite, email);

  let createdUserId = "";
  try {
    const user = await createAuthUser(env, {
      email,
      password,
      metadata: { invite_id: invite.id },
    });
    createdUserId = user.id;

    await upsertProfile(env, user, invite);
    const workspace = await createDefaultWorkspace(env, user.id, invite);
    await upsertNotificationSettings(env, workspace.id);

    const marked = await restPatch(env, "invites", { id: `eq.${invite.id}`, used_at: "is.null" }, {
      used_at: new Date().toISOString(),
      used_by: user.id,
    });
    if (!marked.length) throw userError("邀请码已被使用，请换一个邀请码。", 409);

    const session = await signInWithPassword({ email, password }, env);
    return {
      session,
      profile: {
        id: user.id,
        email,
        role: invite.role || "user",
        maxWallets: invite.max_wallets,
      },
      workspace: workspaceToClient(workspace),
    };
  } catch (error) {
    if (createdUserId) await deleteAuthUser(env, createdUserId).catch(() => {});
    throw error;
  }
}

export async function getUserArchive(env, user) {
  ensureSupabaseConfigured(env);
  const workspace = await getOrCreateDefaultWorkspace(env, user.id);
  const archive = await buildArchiveFromWorkspace(env, workspace);
  return { workspaceId: workspace.id, archive };
}

export async function saveUserArchive(env, user, archive) {
  ensureSupabaseConfigured(env);
  const workspace = await getOrCreateDefaultWorkspace(env, user.id);
  return saveWorkspaceArchive(env, workspace.id, archive);
}

export async function listSupabaseWorkspaceIds(env = process.env) {
  if (!isSupabaseConfigured(env)) return [];
  const rows = await restSelect(env, "workspaces", {
    select: "id",
    order: "created_at.asc",
  });
  return rows.map((row) => String(row.id || "")).filter(Boolean);
}

export async function getSupabaseWorkspaceArchive(env, workspaceId) {
  ensureSupabaseConfigured(env);
  const workspace = await getWorkspaceById(env, workspaceId);
  if (!workspace) return null;
  const archive = await buildArchiveFromWorkspace(env, workspace);
  return { workspaceId: workspace.id, archive };
}

export async function saveSupabaseWorkspaceArchive(env, workspaceId, archive) {
  ensureSupabaseConfigured(env);
  return saveWorkspaceArchive(env, workspaceId, archive);
}

async function saveWorkspaceArchive(env, workspaceId, archive) {
  const workspace = await getWorkspaceById(env, workspaceId);
  if (!workspace) throw userError("Supabase workspace not found", 404);
  const entries = archiveEntries(archive);
  const walletRows = await syncWorkspaceWallets(env, workspace.id, entries);
  const walletIdByAddress = new Map(walletRows.map((row) => [normalizeAddress(row.address), row.id]));
  await saveWorkspaceSettings(env, workspace.id, archive);
  await saveScanResults(env, workspace.id, walletIdByAddress, archive);
  const savedWorkspace = await getWorkspaceById(env, workspace.id);
  const savedArchive = await buildArchiveFromWorkspace(env, savedWorkspace || workspace);
  return { workspaceId: workspace.id, archive: savedArchive };
}

async function buildArchiveFromWorkspace(env, workspace) {
  const settings = isObject(workspace.settings) ? workspace.settings : {};
  const wallets = await restSelect(env, "wallets", {
    workspace_id: `eq.${workspace.id}`,
    is_active: "eq.true",
    select: "id,address,name,sort_order,created_at,updated_at",
    order: "sort_order.asc,created_at.asc",
  });
  const results = await restSelect(env, "wallet_scan_results", {
    workspace_id: `eq.${workspace.id}`,
    select: "wallet_address,snapshot_date,result,source,saved_at",
    order: "snapshot_date.desc,saved_at.desc",
    limit: String(maxResultsPerWorkspace),
  });

  const preferredDate = isUtcDate(settings.endDate) ? settings.endDate : "";
  const resultsByAddress = groupResultsByAddress(results);
  const records = wallets.map((wallet) => {
    const address = normalizeAddress(wallet.address);
    const walletResults = resultsByAddress.get(address) || [];
    const exact = preferredDate ? walletResults.find((row) => row.snapshot_date === preferredDate) : null;
    const latest = exact || walletResults[0] || null;
    const result = isObject(latest?.result) ? latest.result : null;
    return {
      address,
      name: String(wallet.name || ""),
      state: result ? "done" : "idle",
      source: result ? "archive" : "empty",
      result,
      progress: result ? "已从 Supabase 云端归档恢复" : "等待扫描",
      error: "",
      savedAt: typeof latest?.saved_at === "string" ? latest.saved_at : undefined,
    };
  });

  const walletsText = wallets.length
    ? wallets.map((wallet) => walletLine(wallet.name, wallet.address)).join("\n")
    : String(settings.walletsText || "");

  return {
    workspaceId: workspace.id,
    updatedAt: typeof workspace.updated_at === "string" ? workspace.updated_at : undefined,
    walletsText,
    endDate: preferredDate,
    tenDayTarget: String(workspace.ten_day_target || defaultTenDayTarget),
    boostOverrides: String(settings.boostOverrides || ""),
    records,
    scanHistory: Array.isArray(settings.scanHistory) ? settings.scanHistory.slice(0, maxScanHistoryRecords) : [],
    cron: isObject(settings.cron) ? settings.cron : {},
  };
}

async function syncWorkspaceWallets(env, workspaceId, entries) {
  const activeAddresses = new Set(entries.map((entry) => entry.address));
  const existing = await restSelect(env, "wallets", {
    workspace_id: `eq.${workspaceId}`,
    select: "id,address,is_active",
  });

  await Promise.all(
    existing
      .filter((row) => !activeAddresses.has(normalizeAddress(row.address)) && row.is_active)
      .map((row) => restPatch(env, "wallets", { id: `eq.${row.id}` }, { is_active: false })),
  );

  if (!entries.length) return [];
  return restUpsert(
    env,
    "wallets",
    entries.map((entry, index) => ({
      workspace_id: workspaceId,
      address: entry.address,
      name: entry.name,
      sort_order: index,
      is_active: true,
    })),
    "workspace_id,address",
  );
}

async function saveWorkspaceSettings(env, workspaceId, archive) {
  const tenDayTarget = parsePositiveNumber(archive.tenDayTarget) || defaultTenDayTarget;
  const settings = {
    walletsText: String(archive.walletsText || ""),
    endDate: isUtcDate(archive.endDate) ? archive.endDate : "",
    boostOverrides: String(archive.boostOverrides || ""),
    scanHistory: Array.isArray(archive.scanHistory) ? archive.scanHistory.slice(0, maxScanHistoryRecords) : [],
    cron: isObject(archive.cron) ? archive.cron : {},
    updatedFrom: "archive-api",
  };
  await restPatch(env, "workspaces", { id: `eq.${workspaceId}` }, { ten_day_target: tenDayTarget, settings });
}

async function saveScanResults(env, workspaceId, walletIdByAddress, archive) {
  const rows = (Array.isArray(archive.records) ? archive.records : [])
    .filter((record) => isObject(record?.result))
    .map((record) => {
      const result = record.result;
      const address = normalizeAddress(record.address);
      const countedSwaps = Array.isArray(result.swaps) ? result.swaps.filter((swap) => swap.status === "counted") : [];
      return {
        workspace_id: workspaceId,
        wallet_id: walletIdByAddress.get(address) || null,
        wallet_address: address,
        snapshot_date: isUtcDate(result.windowEnd) ? result.windowEnd : archive.endDate,
        window_start: result.windowStart,
        window_end: result.windowEnd,
        boost_volume: Number(result.totalBoostVolume || 0),
        raw_volume: Number(result.totalTradeUsd || 0),
        tx_count: countedSwaps.length,
        result,
        source: record.source || result.txDiscoverySource || "server",
        saved_at: record.savedAt || new Date().toISOString(),
      };
    })
    .filter((row) => isUtcDate(row.snapshot_date) && isUtcDate(row.window_start) && isUtcDate(row.window_end));

  if (!rows.length) return [];
  return restUpsert(env, "wallet_scan_results", rows, "workspace_id,wallet_address,snapshot_date");
}

async function getOrCreateDefaultWorkspace(env, userId) {
  const [existing] = await restSelect(env, "workspaces", {
    owner_id: `eq.${userId}`,
    select: "id,owner_id,name,ten_day_target,settings,created_at,updated_at",
    order: "created_at.asc",
    limit: "1",
  });
  if (existing) return existing;
  return createDefaultWorkspace(env, userId, {});
}

async function getWorkspaceById(env, workspaceId) {
  const [workspace] = await restSelect(env, "workspaces", {
    id: `eq.${workspaceId}`,
    select: "id,owner_id,name,ten_day_target,settings,created_at,updated_at",
    limit: "1",
  });
  return workspace || null;
}

async function createDefaultWorkspace(env, userId, invite) {
  const [workspace] = await restInsert(env, "workspaces", [
    {
      owner_id: userId,
      name: "默认工作区",
      ten_day_target: defaultTenDayTarget,
      settings: {
        source: "invite",
        inviteId: invite?.id || null,
      },
    },
  ]);
  return workspace;
}

async function upsertProfile(env, user, invite) {
  await restUpsert(env, "app_profiles", [
    {
      id: user.id,
      email: normalizeEmail(user.email),
      role: invite.role || "user",
      status: "active",
      max_wallets: invite.max_wallets || 20,
      daily_refresh_limit: invite.daily_refresh_limit || 50,
      daily_rescan_limit: invite.daily_rescan_limit || 10,
    },
  ], "id");
}

async function upsertNotificationSettings(env, workspaceId) {
  await restUpsert(env, "notification_settings", [
    {
      workspace_id: workspaceId,
      feishu_enabled: false,
      notify_future_days: 3,
    },
  ], "workspace_id");
}

async function getAuthUser(token, env) {
  const user = await authFetch(env, "/auth/v1/user", {
    method: "GET",
    apiKey: "publishable",
    bearerToken: token,
  });
  if (!user?.id) throw userError("登录已过期，请重新登录。", 401);
  return user;
}

async function createAuthUser(env, params) {
  const payload = await authFetch(env, "/auth/v1/admin/users", {
    method: "POST",
    apiKey: "secret",
    bearerToken: supabaseConfig(env).secretKey,
    body: {
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: params.metadata || {},
    },
  });
  if (!payload?.id) throw new Error("Supabase did not return created user id");
  return payload;
}

async function deleteAuthUser(env, userId) {
  return authFetch(env, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    apiKey: "secret",
    bearerToken: supabaseConfig(env).secretKey,
  });
}

async function restSelect(env, table, query) {
  const url = supabaseUrl(env, `/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  return supabaseFetch(env, url, { method: "GET" });
}

async function restInsert(env, table, body) {
  return supabaseFetch(env, supabaseUrl(env, `/rest/v1/${table}`), {
    method: "POST",
    body,
    prefer: "return=representation",
  });
}

async function restUpsert(env, table, body, onConflict) {
  const url = supabaseUrl(env, `/rest/v1/${table}`);
  url.searchParams.set("on_conflict", onConflict);
  return supabaseFetch(env, url, {
    method: "POST",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

async function restPatch(env, table, query, body) {
  const url = supabaseUrl(env, `/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  return supabaseFetch(env, url, {
    method: "PATCH",
    body,
    prefer: "return=representation",
  });
}

async function authFetch(env, path, options) {
  ensureSupabaseConfigured(env);
  const config = supabaseConfig(env);
  const apiKey = options.apiKey === "secret" ? config.secretKey : config.publishableKey;
  return fetchJson(supabaseUrl(env, path), {
    method: options.method,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${options.bearerToken || apiKey}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function supabaseFetch(env, url, options) {
  ensureSupabaseConfigured(env);
  const secretKey = supabaseConfig(env).secretKey;
  return fetchJson(url, {
    method: options.method,
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), restTimeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const payload = text ? parseJson(text) : null;
    if (!response.ok) {
      const message =
        payload?.msg ||
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `Supabase HTTP ${response.status}`;
      throw userError(message, response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${restTimeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function authPayloadToSession(payload) {
  if (!payload?.access_token || !payload?.refresh_token || !payload?.user?.id) {
    throw new Error("Supabase auth response is incomplete");
  }
  const expiresIn = Number(payload.expires_in || 3600);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    user: {
      id: payload.user.id,
      email: payload.user.email || "",
    },
  };
}

function validateInvite(invite, email) {
  if (!invite) throw userError("邀请码不存在。", 404);
  if (invite.used_at || invite.used_by) throw userError("邀请码已被使用。", 409);
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw userError("邀请码已过期。", 410);
  }
  const inviteEmail = normalizeEmail(invite.email);
  if (inviteEmail && inviteEmail !== email) {
    throw userError("邀请码绑定的邮箱与当前邮箱不一致。", 403);
  }
}

function archiveEntries(archive) {
  const parsed = parseWalletEntries(String(archive.walletsText || ""));
  const byAddress = new Map(parsed.map((entry) => [entry.address, entry]));
  for (const record of Array.isArray(archive.records) ? archive.records : []) {
    if (!isAddress(record?.address)) continue;
    const address = normalizeAddress(record.address);
    const existing = byAddress.get(address);
    byAddress.set(address, {
      address,
      name: existing?.name || cleanWalletName(record.name || ""),
    });
  }
  return [...byAddress.values()];
}

function parseWalletEntries(raw) {
  const seen = new Set();
  const entries = [];
  for (const rawLine of raw.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const match of line.matchAll(addressPattern)) {
      const address = normalizeAddress(match[0]);
      if (seen.has(address)) continue;
      seen.add(address);
      entries.push({
        address,
        name: cleanWalletName(line.replace(addressPattern, " ")),
      });
    }
  }
  return entries;
}

function groupResultsByAddress(results) {
  const grouped = new Map();
  for (const row of results) {
    if (!isAddress(row.wallet_address)) continue;
    const address = normalizeAddress(row.wallet_address);
    const rows = grouped.get(address) || [];
    rows.push(row);
    grouped.set(address, rows);
  }
  return grouped;
}

function supabaseConfig(env) {
  return {
    url: envValue(env, "SUPABASE_URL"),
    publishableKey: envValue(env, "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: envValue(env, "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function ensureSupabaseConfigured(env) {
  if (!isSupabaseConfigured(env)) {
    throw userError("Supabase is not configured", 503);
  }
}

function supabaseUrl(env, path) {
  const base = supabaseConfig(env).url.replace(/\/+$/, "");
  return new URL(path, `${base}/`);
}

function envValue(env, primary, legacy) {
  return String(env[primary] || (legacy ? env[legacy] || "" : "") || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeInviteCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function hashInviteCode(code) {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

function generateInviteCode() {
  return `OKX-${randomBytes(9).toString("base64url").toUpperCase()}`;
}

function redactInvite(invite) {
  if (!invite) return null;
  return {
    id: String(invite.id || ""),
    email: invite.email || "",
    role: invite.role || "user",
    maxWallets: Number(invite.max_wallets || 0),
    dailyRefreshLimit: Number(invite.daily_refresh_limit || 0),
    dailyRescanLimit: Number(invite.daily_rescan_limit || 0),
    expiresAt: invite.expires_at || "",
    usedAt: invite.used_at || "",
    usedBy: invite.used_by || "",
    createdAt: invite.created_at || "",
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function workspaceToClient(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    tenDayTarget: workspace.ten_day_target,
  };
}

function walletLine(name, address) {
  const cleanName = cleanWalletName(name || "");
  const normalizedAddress = normalizeAddress(address);
  return cleanName ? `${cleanName} ${normalizedAddress}` : normalizedAddress;
}

function cleanWalletName(raw) {
  return String(raw || "").replace(/[=：:|,，;；]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function parsePositiveNumber(value) {
  const parsed = Number(String(value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function isUtcDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function userError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[name.toLowerCase()] || headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}
