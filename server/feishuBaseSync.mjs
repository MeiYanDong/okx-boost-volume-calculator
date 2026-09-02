import { requestUrl, sendJson, validateAccess } from "./proxy.mjs";
import {
  getWorkspaceFeishuBaseOAuth,
  getSupabaseUserFromRequest,
  getSupabaseWorkspaceArchive,
  getUserArchive,
  saveWorkspaceFeishuBaseOAuth,
} from "./supabaseStore.mjs";

const DEFAULT_BASE_TOKEN = "PXI5bYvkuaY77dsyiVvcPioZnLR";
const DEFAULT_TABLE_ID = "tblYcRHoWbtFjWkw";
const DEFAULT_WORKSPACE_ID = "eb029218-1b74-4df3-a378-fe8537dfd727";
const DEFAULT_OWNER_EMAIL = "myandong1@gmail.com";
const DEFAULT_START_DATE = "2026-06-18";
const DEFAULT_OPEN_API_ORIGIN = "https://open.feishu.cn";

const FIELD_NAMES = {
  date: "日期",
  account: "账户",
  token: "代币",
  tradeUsd: "成交额",
  wearGrossUsd: "磨损（不算返佣）",
  boostMultiplier: "Boost 倍数",
  bonusRate: "加成",
  serviceFeeRate: "服务费",
};

const REQUIRED_WRITE_FIELDS = [
  FIELD_NAMES.date,
  FIELD_NAMES.account,
  FIELD_NAMES.token,
  FIELD_NAMES.tradeUsd,
  FIELD_NAMES.wearGrossUsd,
  FIELD_NAMES.boostMultiplier,
  FIELD_NAMES.bonusRate,
  FIELD_NAMES.serviceFeeRate,
];

let tenantTokenCache = null;

export function getFeishuBaseSyncConfig(env = {}) {
  const appId = firstEnv(env, ["FEISHU_APP_ID", "LARK_APP_ID"]);
  const appSecret = firstEnv(env, ["FEISHU_APP_SECRET", "LARK_APP_SECRET"]);
  const baseToken = firstEnv(env, ["FEISHU_BASE_TOKEN", "LARK_BASE_TOKEN"]) || DEFAULT_BASE_TOKEN;
  const tableId = firstEnv(env, ["FEISHU_BASE_TABLE_ID", "LARK_BASE_TABLE_ID"]) || DEFAULT_TABLE_ID;
  const allowedWorkspaceId =
    firstEnv(env, ["FEISHU_BASE_SYNC_WORKSPACE_ID", "OKX_BOOST_WORKSPACE_ID"]) || DEFAULT_WORKSPACE_ID;
  const allowedOwnerEmail =
    firstEnv(env, ["FEISHU_BASE_SYNC_OWNER_EMAIL", "OKX_BOOST_OWNER_EMAIL"]) || DEFAULT_OWNER_EMAIL;
  const startDate = normalizeDate(
    firstEnv(env, ["FEISHU_BASE_SYNC_START_DATE", "OKX_BOOST_SYNC_START_DATE"]) || DEFAULT_START_DATE,
  );
  const disabled = parseBoolean(firstEnv(env, ["FEISHU_BASE_SYNC_DISABLED"]));
  const explicitEnabled = firstEnv(env, ["FEISHU_BASE_SYNC_ENABLED"]);
  const credentialsReady = Boolean(appId && appSecret && baseToken && tableId);
  const enabled = credentialsReady && !disabled && (!explicitEnabled || parseBoolean(explicitEnabled));

  return {
    enabled,
    credentialsReady,
    appId,
    appSecret,
    baseToken,
    tableId,
    allowedWorkspaceId,
    allowedOwnerEmail: normalizeEmail(allowedOwnerEmail),
    startDate,
    dryRun: parseBoolean(firstEnv(env, ["FEISHU_BASE_SYNC_DRY_RUN"])),
    openApiOrigin: firstEnv(env, ["FEISHU_OPEN_API_ORIGIN", "LARK_OPEN_API_ORIGIN"]) || DEFAULT_OPEN_API_ORIGIN,
    defaultBoostMultiplier: finiteNumber(firstEnv(env, ["FEISHU_BASE_DEFAULT_BOOST_MULTIPLIER"]), 0.5),
    defaultBonusRate: finiteNumber(firstEnv(env, ["FEISHU_BASE_DEFAULT_BONUS_RATE"]), 0.2),
    defaultServiceFeeRate: finiteNumber(firstEnv(env, ["FEISHU_BASE_DEFAULT_SERVICE_FEE_RATE"]), 0.005),
    authMode: (firstEnv(env, ["FEISHU_BASE_SYNC_AUTH_MODE", "LARK_BASE_SYNC_AUTH_MODE"]) || "auto").toLowerCase(),
  };
}

export async function syncFeishuBaseFromArchive(env = {}, params = {}) {
  const syncConfig = getFeishuBaseSyncConfig(env);
  const workspaceId = params.workspaceId || params.workspace?.workspaceId || params.workspace?.id || "";
  const ownerEmail = normalizeEmail(params.ownerEmail || params.userEmail || params.workspace?.ownerEmail || "");
  const dryRun = Boolean(params.dryRun || syncConfig.dryRun);
  const replaceDates = normalizeReplaceDates(params.replaceDates, syncConfig.startDate);

  if (!syncConfig.credentialsReady) {
    return {
      ok: true,
      skipped: true,
      reason: "feishu_credentials_missing",
      dryRun,
      rows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      warnings: [],
    };
  }

  if (!syncConfig.enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "feishu_sync_disabled",
      dryRun,
      rows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      warnings: [],
    };
  }

  if (!isAllowedSyncTarget(syncConfig, workspaceId, ownerEmail)) {
    return {
      ok: true,
      skipped: true,
      reason: "workspace_not_allowed",
      dryRun,
      workspaceId,
      ownerEmail: ownerEmail || null,
      rows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      warnings: [],
    };
  }

  const archive = params.archive || {};
  const clients = await createFeishuClients(syncConfig, env, workspaceId);
  if (clients.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "feishu_user_oauth_missing",
      dryRun,
      workspaceId,
      ownerEmail: ownerEmail || null,
      rows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      warnings: [],
    };
  }

  let lastPermissionError = null;
  for (const client of clients) {
    try {
      const result = await syncFeishuBaseWithClient(client, archive, syncConfig, dryRun, replaceDates);
      return {
        ...result,
        workspaceId,
        ownerEmail: ownerEmail || null,
        authMode: client.authMode,
      };
    } catch (error) {
      if (client.authMode === "tenant" && isFeishuScopeError(error) && clients.length > 1) {
        lastPermissionError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastPermissionError || new Error("Feishu Base sync did not run");
}

async function syncFeishuBaseWithClient(client, archive, syncConfig, dryRun, replaceDates = []) {
  const fields = await listFields(client);
  const fieldMap = makeFieldMap(fields);
  validateRequiredFields(fieldMap);

  const fullBuild = buildSyncRowsFromArchive(archive, syncConfig, fieldMap);
  const replaceDateSet = new Set(replaceDates);
  const build = replaceDateSet.size
    ? {
        ...fullBuild,
        rows: fullBuild.rows.filter((row) => replaceDateSet.has(row.date)),
      }
    : fullBuild;
  if (build.rows.length === 0 && replaceDateSet.size === 0) {
    return {
      ok: true,
      skipped: false,
      dryRun,
      rows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      deleted: 0,
      warnings: build.warnings,
      startDate: syncConfig.startDate,
    };
  }

  const existingRecords = await listRecords(client);
  const replacePlan = splitExistingRecordsByDates(existingRecords, fieldMap, replaceDateSet);
  const existingIndex = makeExistingIndex(replacePlan.keptRecords, fieldMap, build.rows);
  const createPayloads = [];
  const updatePayloads = [];
  let unchanged = 0;

  for (const row of build.rows) {
    const payload = rowToFeishuFields(row, fieldMap);
    const existing = existingIndex.get(row.key);
    if (!existing) {
      createPayloads.push({ key: row.key, fields: payload });
      continue;
    }

    const patch = diffFeishuFields(existing.fields, payload, fieldMap);
    if (Object.keys(patch).length === 0) {
      unchanged += 1;
      continue;
    }
    updatePayloads.push({
      key: row.key,
      recordId: existing.recordId,
      fields: patch,
    });
  }

  if (!dryRun) {
    await deleteRecords(client, replacePlan.deleteRecordIds);
    await createRecords(client, createPayloads);
    await updateRecords(client, updatePayloads);
  }

  return {
    ok: true,
    skipped: false,
    dryRun,
    rows: build.rows.length,
    created: createPayloads.length,
    updated: updatePayloads.length,
    unchanged,
    deleted: replacePlan.deleteRecordIds.length,
    rebuiltDates: [...replaceDateSet],
    expectedBoostVolume: roundNumber(
      build.rows.reduce((sum, row) => sum + row.tradeUsd * row.boostMultiplier * (1 + row.bonusRate), 0),
      8,
    ),
    repairedDuplicates: existingIndex.repairedDuplicates,
    warnings: [...build.warnings, ...existingIndex.warnings],
    startDate: syncConfig.startDate,
  };
}

export async function handleFeishuBaseSyncApi(request, response, config, env = process.env) {
  if (request.method !== "POST" && request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const url = requestUrl(request);
    const dryRun = parseBoolean(url.searchParams.get("dryRun")) || parseBoolean(url.searchParams.get("dry_run"));
    const rebuildDate = normalizeDate(url.searchParams.get("rebuildDate") || url.searchParams.get("rebuild_date"));
    let workspaceId = url.searchParams.get("workspace") || "";
    let ownerEmail = "";
    let archive = null;

    const auth = await getSupabaseUserFromRequest(request, env).catch(() => null);
    if (auth?.user?.id) {
      if (rebuildDate && (request.method !== "POST" || auth.profile?.role !== "admin")) {
        sendJson(response, 403, { error: "admin_required_for_rebuild" });
        return;
      }
      const saved = await getUserArchive(env, auth.user);
      workspaceId = saved.workspaceId;
      archive = saved.archive;
      ownerEmail = auth.user.email || "";
    } else {
      if (rebuildDate) {
        sendJson(response, 403, { error: "admin_session_required_for_rebuild" });
        return;
      }
      validateAccess(request, config, env);
      const syncConfig = getFeishuBaseSyncConfig(env);
      workspaceId = workspaceId || syncConfig.allowedWorkspaceId;
      if (!workspaceId) {
        sendJson(response, 400, { error: "workspace_required" });
        return;
      }
      const saved = await getSupabaseWorkspaceArchive(env, workspaceId);
      if (!saved) {
        sendJson(response, 404, { error: "workspace_not_found", workspaceId });
        return;
      }
      archive = saved.archive;
      ownerEmail = syncConfig.allowedOwnerEmail;
    }

    const result = await syncFeishuBaseFromArchive(env, {
      workspaceId,
      ownerEmail,
      archive,
      dryRun,
      replaceDates: rebuildDate ? [rebuildDate] : [],
      trigger: "manual",
    });
    sendJson(response, 200, result);
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status) || 500;
    sendJson(response, statusCode, {
      error: statusCode === 401 ? "unauthorized" : "feishu_base_sync_failed",
      message: error?.message || String(error),
    });
  }
}

function firstEnv(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function parseBoolean(value) {
  if (value == null || value === "") return false;
  const text = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(text);
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function finiteNumber(value, fallback) {
  if (value == null || String(value).trim() === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeReplaceDates(values, startDate) {
  const dates = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(dates.map(normalizeDate).filter((date) => date && !isBeforeDate(date, startDate)))];
}

function normalizeDate(value) {
  const scalar = Array.isArray(value) ? value[0] : value;
  if (scalar && typeof scalar === "object") {
    return normalizeDate(scalar.timestamp ?? scalar.value ?? scalar.text ?? scalar.name ?? scalar.date ?? scalar[0]);
  }
  if (typeof scalar === "number" || /^\d{10,13}$/.test(String(scalar || "").trim())) {
    const numeric = Number(scalar);
    if (Number.isFinite(numeric)) {
      const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      return dateInTimeZone(millis, "Asia/Shanghai");
    }
  }
  const text = String(scalar || "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function dateInTimeZone(timestampMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isAllowedSyncTarget(syncConfig, workspaceId, ownerEmail) {
  if (syncConfig.allowedWorkspaceId && workspaceId !== syncConfig.allowedWorkspaceId) {
    return false;
  }
  if (syncConfig.allowedOwnerEmail && ownerEmail !== syncConfig.allowedOwnerEmail) {
    return false;
  }
  return true;
}

async function createFeishuClients(syncConfig, env, workspaceId) {
  const clients = [];
  const authMode = syncConfig.authMode || "auto";

  if (authMode !== "user") {
    clients.push(await createFeishuTenantClient(syncConfig));
  }

  if (authMode !== "tenant" && workspaceId) {
    const oauthRecord = await getWorkspaceFeishuBaseOAuth(env, workspaceId).catch(() => null);
    if (oauthRecord?.oauth?.refreshToken || oauthRecord?.oauth?.accessToken) {
      clients.push(await createFeishuUserClient(syncConfig, env, workspaceId, oauthRecord.oauth));
    }
  }

  return clients;
}

async function createFeishuTenantClient(syncConfig) {
  const tenantAccessToken = await getTenantAccessToken(syncConfig);
  return {
    origin: syncConfig.openApiOrigin.replace(/\/+$/, ""),
    baseToken: syncConfig.baseToken,
    tableId: syncConfig.tableId,
    accessToken: tenantAccessToken,
    authMode: "tenant",
  };
}

async function createFeishuUserClient(syncConfig, env, workspaceId, oauth) {
  const accessToken = await getUserAccessToken(syncConfig, env, workspaceId, oauth);
  return {
    origin: syncConfig.openApiOrigin.replace(/\/+$/, ""),
    baseToken: syncConfig.baseToken,
    tableId: syncConfig.tableId,
    accessToken,
    authMode: "user",
  };
}

async function getTenantAccessToken(syncConfig) {
  const cacheKey = `${syncConfig.openApiOrigin}|${syncConfig.appId}`;
  const now = Date.now();
  if (tenantTokenCache?.cacheKey === cacheKey && tenantTokenCache.expiresAt > now + 60_000) {
    return tenantTokenCache.token;
  }

  const json = await feishuFetch(
    `${syncConfig.openApiOrigin.replace(/\/+$/, "")}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      body: {
        app_id: syncConfig.appId,
        app_secret: syncConfig.appSecret,
      },
      timeoutMs: 15_000,
    },
  );
  const token = json?.tenant_access_token || json?.data?.tenant_access_token;
  if (!token) {
    throw new Error("Feishu tenant_access_token missing in response");
  }
  const expiresIn = Number(json?.expire || json?.data?.expire || 5400);
  tenantTokenCache = {
    cacheKey,
    token,
    expiresAt: now + Math.max(300, expiresIn - 120) * 1000,
  };
  return token;
}

async function feishuApi(client, path, options = {}) {
  return feishuFetch(`${client.origin}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${client.accessToken}`,
      ...(options.headers || {}),
    },
  });
}

async function feishuFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25_000);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(options.headers || {}),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (response.ok) return {};
        const parseError = new Error(`Feishu HTTP ${response.status}: invalid JSON response`);
        parseError.statusCode = response.status;
        throw parseError;
      }
    }
    if (!response.ok) {
      const error = new Error(`Feishu HTTP ${response.status}: ${json?.msg || json?.message || text}`);
      error.statusCode = response.status;
      error.feishuCode = Number(json?.code);
      throw error;
    }
    if (json?.code != null && Number(json.code) !== 0) {
      const error = new Error(`Feishu API ${json.code}: ${json?.msg || json?.message || "request failed"}`);
      error.feishuCode = Number(json.code);
      throw error;
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function getUserAccessToken(syncConfig, env, workspaceId, oauth) {
  const now = Date.now();
  if (oauth?.accessToken && timestampMs(oauth.accessExpiresAt) > now + 60_000) {
    return oauth.accessToken;
  }
  if (!oauth?.refreshToken) {
    throw new Error("Feishu user OAuth refresh token is missing");
  }
  if (oauth.refreshExpiresAt && timestampMs(oauth.refreshExpiresAt) <= now + 60_000) {
    throw new Error("Feishu user OAuth refresh token expired");
  }

  const json = await feishuFetch(`${syncConfig.openApiOrigin.replace(/\/+$/, "")}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    body: {
      grant_type: "refresh_token",
      client_id: syncConfig.appId,
      client_secret: syncConfig.appSecret,
      refresh_token: oauth.refreshToken,
    },
    timeoutMs: 15_000,
  });
  const next = normalizeOAuthToken(json?.data || json, now, oauth);
  await saveWorkspaceFeishuBaseOAuth(env, workspaceId, next);
  return next.accessToken;
}

export function normalizeOAuthToken(data, now = Date.now(), previous = {}) {
  const accessToken = data?.access_token || data?.user_access_token || previous?.accessToken || "";
  const refreshToken = data?.refresh_token || previous?.refreshToken || "";
  const expiresIn = Number(data?.expires_in || data?.expire || data?.access_token_expires_in || 0);
  const refreshExpiresIn = Number(data?.refresh_expires_in || data?.refresh_token_expires_in || 0);
  return {
    enabled: true,
    tokenType: data?.token_type || previous?.tokenType || "Bearer",
    scope: data?.scope || previous?.scope || "",
    accessToken,
    refreshToken,
    accessExpiresAt:
      expiresIn > 0
        ? new Date(now + Math.max(30, expiresIn - 60) * 1000).toISOString()
        : previous?.accessExpiresAt || "",
    refreshExpiresAt:
      refreshExpiresIn > 0
        ? new Date(now + Math.max(30, refreshExpiresIn - 60) * 1000).toISOString()
        : previous?.refreshExpiresAt || "",
  };
}

function isFeishuScopeError(error) {
  return (
    Number(error?.feishuCode) === 99991672 ||
    /app_scope_not_applied|required scopes?|scopes is required|应用身份权限/i.test(String(error?.message || ""))
  );
}

function timestampMs(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

async function listFields(client) {
  const fields = [];
  let pageToken = "";

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams();
    params.set("page_size", "100");
    if (pageToken) params.set("page_token", pageToken);

    const json = await feishuApi(
      client,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.baseToken)}/tables/${encodeURIComponent(
        client.tableId,
      )}/fields?${params.toString()}`,
    );
    const data = json?.data || {};
    const items = data.items || data.fields || [];
    fields.push(...items);

    if (data.has_more && data.page_token) {
      pageToken = data.page_token;
      continue;
    }
    break;
  }

  return fields;
}

async function listRecords(client) {
  const records = [];
  let pageToken = "";

  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams();
    params.set("page_size", "500");
    if (pageToken) params.set("page_token", pageToken);

    const json = await feishuApi(
      client,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.baseToken)}/tables/${encodeURIComponent(
        client.tableId,
      )}/records?${params.toString()}`,
    );
    const data = json?.data || {};
    const items = data.items || data.records || [];
    records.push(...items);

    if (data.has_more && data.page_token) {
      pageToken = data.page_token;
      continue;
    }
    break;
  }

  return records;
}

async function createRecords(client, rows) {
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    if (chunk.length === 0) continue;
    await feishuApi(
      client,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.baseToken)}/tables/${encodeURIComponent(
        client.tableId,
      )}/records/batch_create`,
      {
        method: "POST",
        body: {
          records: chunk.map((row) => ({ fields: row.fields })),
        },
      },
    );
  }
}

async function deleteRecords(client, recordIds) {
  for (const recordId of recordIds) {
    await feishuApi(
      client,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.baseToken)}/tables/${encodeURIComponent(
        client.tableId,
      )}/records/${encodeURIComponent(recordId)}`,
      { method: "DELETE" },
    );
  }
}

async function updateRecords(client, rows) {
  for (const row of rows) {
    await feishuApi(
      client,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.baseToken)}/tables/${encodeURIComponent(
        client.tableId,
      )}/records/${encodeURIComponent(row.recordId)}`,
      {
        method: "PUT",
        body: {
          fields: row.fields,
        },
      },
    );
  }
}

function makeFieldMap(fields) {
  const byName = new Map();
  const byId = new Map();
  for (const field of fields) {
    const name = field?.field_name || field?.name;
    const id = field?.field_id || field?.id;
    if (name) byName.set(name, { ...field, name, id });
    if (id) byId.set(id, { ...field, name, id });
  }
  return {
    fields,
    byName,
    byId,
  };
}

function validateRequiredFields(fieldMap) {
  const missing = REQUIRED_WRITE_FIELDS.filter((fieldName) => !fieldMap.byName.has(fieldName));
  if (missing.length > 0) {
    throw new Error(`Feishu Base missing fields: ${missing.join(", ")}`);
  }
}

function buildSyncRowsFromArchive(archive, syncConfig, fieldMap) {
  const warnings = [];
  const rows = [];
  const records = Array.isArray(archive?.records) ? archive.records : [];
  const accountOptions = getFieldOptions(fieldMap.byName.get(FIELD_NAMES.account));
  const tokenOptions = getFieldOptions(fieldMap.byName.get(FIELD_NAMES.token));
  const walletOrdinals = makeWalletOrdinalMap(archive?.walletsText);

  records.forEach((record, index) => {
    const result = record?.result;
    if (!result) return;

    const account = chooseAccountName(record, index, accountOptions, walletOrdinals);
    if (!account) {
      warnings.push(`skip_wallet_${index + 1}_missing_account_option`);
      return;
    }

    const groups = aggregateRecordByDateAndToken(result, syncConfig, tokenOptions, warnings, account);
    for (const group of groups.values()) {
      if (group.tradeUsd <= 0 && group.wearGrossUsd <= 0) continue;
      rows.push({
        key: makeRowKey(group.date, account, group.token),
        date: group.date,
        account,
        token: group.token,
        tradeUsd: roundNumber(group.tradeUsd, 8),
        wearGrossUsd: roundNumber(group.wearGrossUsd, 8),
        boostMultiplier: roundNumber(group.boostMultiplier || syncConfig.defaultBoostMultiplier, 8),
        bonusRate: roundNumber(syncConfig.defaultBonusRate, 8),
        serviceFeeRate: roundNumber(syncConfig.defaultServiceFeeRate, 8),
      });
    }
  });

  rows.sort((left, right) => left.key.localeCompare(right.key));
  return { rows, warnings };
}

function aggregateRecordByDateAndToken(result, syncConfig, tokenOptions, warnings, account) {
  const groups = new Map();
  const swaps = Array.isArray(result?.swaps) ? result.swaps : [];

  for (const swap of swaps) {
    if (swap?.status === "excluded") continue;
    const date = normalizeDate(swap?.utcDate || swap?.date || swap?.timestamp);
    if (!date || isBeforeDate(date, syncConfig.startDate)) continue;
    const tradeUsd = finiteNumber(swap?.tradeUsd ?? swap?.usdValue ?? swap?.amountUsd, 0);
    const wearGrossUsd = finiteNumber(swap?.wearUsd ?? swap?.wearGrossUsd ?? swap?.lossUsd, 0);
    if (tradeUsd <= 0 && wearGrossUsd <= 0) continue;
    const token = chooseTokenName(swap, tokenOptions);
    if (!token) {
      warnings.push(`skip_${account}_${date}_missing_token_option`);
      continue;
    }
    const key = makeRowKey(date, account, token);
    const group = groups.get(key) || {
      date,
      token,
      tradeUsd: 0,
      wearGrossUsd: 0,
      boostMultiplier: finiteNumber(swap?.baseMultiplier, syncConfig.defaultBoostMultiplier),
    };
    group.tradeUsd += tradeUsd;
    group.wearGrossUsd += wearGrossUsd;
    if (Number.isFinite(Number(swap?.baseMultiplier))) {
      group.boostMultiplier = Number(swap.baseMultiplier);
    }
    groups.set(key, group);
  }

  if (groups.size === 0 && Array.isArray(result?.dailyRows)) {
    const fallbackToken = tokenOptions.find((option) => normalizedName(option) === "qic") || "QIC";
    for (const day of result.dailyRows) {
      const date = normalizeDate(day?.date);
      if (!date || isBeforeDate(date, syncConfig.startDate)) continue;
      const tradeUsd = finiteNumber(day?.tradeUsd, 0);
      if (tradeUsd <= 0) continue;
      groups.set(makeRowKey(date, account, fallbackToken), {
        date,
        token: fallbackToken,
        tradeUsd,
        wearGrossUsd: 0,
        boostMultiplier: syncConfig.defaultBoostMultiplier,
      });
    }
  }

  return groups;
}

function chooseAccountName(record, index, accountOptions, walletOrdinals = new Map()) {
  const labels = [record?.account, record?.name, record?.walletName, record?.label]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const candidates = [];
  for (const label of labels) {
    const ordinal = accountOrdinalFromLabel(label);
    if (ordinal) candidates.push(...accountOptionCandidates(ordinal));
    candidates.push(label);
  }

  const addressOrdinal = walletOrdinals.get(normalizeAddress(record?.address));
  if (addressOrdinal) candidates.push(...accountOptionCandidates(addressOrdinal));
  candidates.push(...accountOptionCandidates(index + 1));

  return findExistingOption(uniqueStrings(candidates), accountOptions);
}

function makeWalletOrdinalMap(walletsText) {
  const ordinals = new Map();
  const seen = new Set();
  const addressPattern = /0x[a-fA-F0-9]{40}/g;
  for (const line of String(walletsText || "").split(/\r?\n/)) {
    for (const match of line.matchAll(addressPattern)) {
      const address = normalizeAddress(match[0]);
      if (!address || seen.has(address)) continue;
      seen.add(address);
      ordinals.set(address, ordinals.size + 1);
    }
  }
  return ordinals;
}

function accountOrdinalFromLabel(label) {
  const match = String(label || "").match(/(?:okx\s*boost\s*-?\s*)?(\d{1,3})(?!\d)/i);
  if (!match) return 0;
  const ordinal = Number(match[1]);
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : 0;
}

function accountOptionCandidates(ordinal) {
  return [`okxboost-${ordinal}`, `okxboost -${ordinal}`];
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function chooseTokenName(swap, tokenOptions) {
  const candidates = [
    swap?.campaignToken,
    swap?.token,
    swap?.tokenSymbol,
    swap?.inputToken?.symbol,
    swap?.outputToken?.symbol,
    swap?.inputSymbol,
    swap?.outputSymbol,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((symbol) => !isStableSymbol(symbol));

  if (candidates.length === 0) {
    candidates.push("QIC");
  }
  return findExistingOption(candidates, tokenOptions);
}

function findExistingOption(candidates, options) {
  if (!Array.isArray(options) || options.length === 0) {
    return candidates[0] || "";
  }
  const normalizedOptions = new Map(options.map((option) => [normalizedName(option), option]));
  for (const candidate of candidates) {
    const exact = options.find((option) => option === candidate);
    if (exact) return exact;
    const normalized = normalizedName(candidate);
    if (normalizedOptions.has(normalized)) return normalizedOptions.get(normalized);
  }
  return candidates[0] || "";
}

function isStableSymbol(symbol) {
  const normalized = normalizedName(symbol);
  return (
    normalized === "usd" ||
    normalized === "usdt" ||
    normalized === "usdc" ||
    normalized === "dai" ||
    normalized.startsWith("usd")
  );
}

function getFieldOptions(field) {
  const property = field?.property || field?.ui_property || {};
  const options = property.options || property.options_list || field?.options || [];
  return options
    .map((option) => option?.name || option?.text || option?.label || option?.value || option)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function rowToFeishuFields(row, fieldMap) {
  return {
    [FIELD_NAMES.date]: formatDateCell(row.date, fieldMap.byName.get(FIELD_NAMES.date)),
    [FIELD_NAMES.account]: row.account,
    [FIELD_NAMES.token]: row.token,
    [FIELD_NAMES.tradeUsd]: formatByField(fieldMap.byName.get(FIELD_NAMES.tradeUsd), row.tradeUsd),
    [FIELD_NAMES.wearGrossUsd]: formatByField(fieldMap.byName.get(FIELD_NAMES.wearGrossUsd), row.wearGrossUsd),
    [FIELD_NAMES.boostMultiplier]: formatByField(fieldMap.byName.get(FIELD_NAMES.boostMultiplier), row.boostMultiplier),
    [FIELD_NAMES.bonusRate]: formatByField(fieldMap.byName.get(FIELD_NAMES.bonusRate), row.bonusRate),
    [FIELD_NAMES.serviceFeeRate]: formatByField(fieldMap.byName.get(FIELD_NAMES.serviceFeeRate), row.serviceFeeRate),
  };
}

function formatByField(field, value) {
  const type = normalizedFieldType(field);
  if (type === "text" || type === "barcode") {
    return trimNumericString(value);
  }
  return roundNumber(value, 8);
}

function normalizedFieldType(field) {
  const numericType = Number(field?.type);
  if (Number.isFinite(numericType)) {
    if ([1, 13, 15].includes(numericType)) return "text";
    if (numericType === 2) return "number";
    if ([3, 4].includes(numericType)) return "select";
    if (numericType === 5) return "date";
    if (numericType === 7) return "checkbox";
  }
  const type = String(field?.type || field?.ui_type || field?.control || "").toLowerCase();
  if (type.includes("text")) return "text";
  if (type.includes("number") || type.includes("currency") || type.includes("percent")) return "number";
  if (type.includes("date")) return "date";
  return type;
}

function formatDateCell(date) {
  return dateToShanghaiMidnightMs(date);
}

function dateToShanghaiMidnightMs(date) {
  const normalized = normalizeDate(date);
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return "";
  return Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000;
}

function makeExistingIndex(records, fieldMap, desiredRows = []) {
  const index = new Map();
  const warnings = [];
  const duplicates = [];

  for (const record of records) {
    const recordId = record?.record_id || record?.id;
    if (!recordId) continue;
    const fields = record?.fields || record?.field_values || {};
    const date = normalizeDate(readFieldValue(fields, fieldMap, FIELD_NAMES.date));
    const account = extractSelectText(readFieldValue(fields, fieldMap, FIELD_NAMES.account));
    const token = extractSelectText(readFieldValue(fields, fieldMap, FIELD_NAMES.token));
    if (!date || !account || !token) continue;
    const key = makeRowKey(date, account, token);
    if (index.has(key)) {
      duplicates.push({ key, date, token, recordId, fields });
      continue;
    }
    index.set(key, { recordId, fields });
  }

  const missingRows = new Map(desiredRows.filter((row) => !index.has(row.key)).map((row) => [row.key, row]));
  let repairedDuplicates = 0;

  for (const duplicate of duplicates) {
    const desired = [...missingRows.values()].find(
      (row) =>
        row.date === duplicate.date &&
        normalizedName(row.token) === normalizedName(duplicate.token) &&
        existingRowMatchesDesiredExceptAccount(duplicate.fields, row, fieldMap),
    );
    if (!desired) {
      warnings.push(`duplicate_feishu_row_${duplicate.key}`);
      continue;
    }
    index.set(desired.key, { recordId: duplicate.recordId, fields: duplicate.fields });
    missingRows.delete(desired.key);
    repairedDuplicates += 1;
  }

  index.warnings = warnings;
  index.repairedDuplicates = repairedDuplicates;
  return index;
}

function splitExistingRecordsByDates(records, fieldMap, replaceDateSet) {
  if (!(replaceDateSet instanceof Set) || replaceDateSet.size === 0) {
    return { keptRecords: records, deleteRecordIds: [] };
  }
  const keptRecords = [];
  const deleteRecordIds = [];
  for (const record of records) {
    const fields = record?.fields || record?.field_values || {};
    const date = normalizeDate(readFieldValue(fields, fieldMap, FIELD_NAMES.date));
    const recordId = record?.record_id || record?.id;
    if (date && recordId && replaceDateSet.has(date)) {
      deleteRecordIds.push(recordId);
    } else {
      keptRecords.push(record);
    }
  }
  return { keptRecords, deleteRecordIds };
}

function existingRowMatchesDesiredExceptAccount(existingFields, desiredRow, fieldMap) {
  const desiredFields = rowToFeishuFields(desiredRow, fieldMap);
  return [FIELD_NAMES.tradeUsd, FIELD_NAMES.wearGrossUsd].every((fieldName) => {
    const desiredValue = desiredFields[fieldName];
    const existingValue = readFieldValue(existingFields, fieldMap, fieldName);
    const existingNumber = parseLooseNumber(existingValue);
    const desiredNumber = parseLooseNumber(desiredValue);
    return (
      Number.isFinite(existingNumber) &&
      Number.isFinite(desiredNumber) &&
      Math.abs(existingNumber - desiredNumber) < 0.0001
    );
  });
}

function diffFeishuFields(existingFields, desiredFields, fieldMap) {
  const patch = {};
  for (const [fieldName, desiredValue] of Object.entries(desiredFields)) {
    const existingValue = readFieldValue(existingFields, fieldMap, fieldName);
    if (!cellsEqual(existingValue, desiredValue, fieldName, fieldMap)) {
      patch[fieldName] = desiredValue;
    }
  }
  return patch;
}

function readFieldValue(fields, fieldMap, fieldName) {
  const field = fieldMap.byName.get(fieldName);
  if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
    return fields[fieldName];
  }
  if (field?.id && Object.prototype.hasOwnProperty.call(fields, field.id)) {
    return fields[field.id];
  }
  return undefined;
}

function cellsEqual(existingValue, desiredValue, fieldName, fieldMap) {
  if (fieldName === FIELD_NAMES.date) {
    return normalizeDate(existingValue) === normalizeDate(desiredValue);
  }
  if (fieldName === FIELD_NAMES.account || fieldName === FIELD_NAMES.token) {
    return normalizedName(extractSelectText(existingValue)) === normalizedName(desiredValue);
  }

  const field = fieldMap.byName.get(fieldName);
  const type = normalizedFieldType(field);
  if (type === "text") {
    const existingNumber = parseLooseNumber(existingValue);
    const desiredNumber = parseLooseNumber(desiredValue);
    if (Number.isFinite(existingNumber) && Number.isFinite(desiredNumber)) {
      return Math.abs(existingNumber - desiredNumber) < 0.0001;
    }
    return String(existingValue || "") === String(desiredValue || "");
  }

  const existingNumber = parseLooseNumber(existingValue);
  const desiredNumber = parseLooseNumber(desiredValue);
  if (Number.isFinite(existingNumber) && Number.isFinite(desiredNumber)) {
    return Math.abs(existingNumber - desiredNumber) < 0.0000001;
  }
  return JSON.stringify(existingValue ?? null) === JSON.stringify(desiredValue ?? null);
}

function extractSelectText(value) {
  if (Array.isArray(value)) {
    return value.map(extractSelectText).filter(Boolean).join(",");
  }
  if (value && typeof value === "object") {
    return value.text || value.name || value.label || value.value || value.option_name || value[0]?.text || "";
  }
  return String(value || "").trim();
}

function parseLooseNumber(value) {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return parseLooseNumber(value[0]);
  if (value && typeof value === "object") {
    return parseLooseNumber(value.value ?? value.text ?? value.name ?? value[0]);
  }
  const text = String(value || "").replace(/[$,%\s,]/g, "");
  if (!text) return Number.NaN;
  return Number(text);
}

function normalizedName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeAddress(value) {
  const address = String(value || "")
    .trim()
    .toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function makeRowKey(date, account, token) {
  return `${date}|${normalizedName(account)}|${normalizedName(token)}`;
}

function isBeforeDate(date, startDate) {
  return Boolean(startDate && date < startDate);
}

function roundNumber(value, precision) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** precision;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function trimNumericString(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(8).replace(/\.?0+$/, "");
}

export const feishuBaseSyncTestHelpers = {
  buildSyncRowsFromArchive,
  isAllowedSyncTarget,
  makeExistingIndex,
  makeFieldMap,
  splitExistingRecordsByDates,
};
