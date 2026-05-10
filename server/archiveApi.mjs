import { getServerArchive, isArchiveStoreConfigured, normalizeWorkspaceId, setServerArchive } from "./archiveStore.mjs";
import { readJsonBody, requestUrl, sendJson, validateAccess } from "./proxy.mjs";

const maxWalletsTextLength = 20_000;
const maxBonusRulesLength = 50_000;
const maxRecords = 200;

export async function handleArchiveApi(request, response, config, env = process.env) {
  validateAccess(request, config);
  const url = requestUrl(request);

  if (request.method === "GET") {
    const workspaceId = archiveWorkspaceId(request, url);
    const configured = isArchiveStoreConfigured(env);
    const archive = configured ? await getServerArchive(env, workspaceId) : null;
    sendJson(response, 200, { configured, workspaceId, archive }, { "cache-control": "no-store" });
    return;
  }

  if (request.method === "POST") {
    if (!isArchiveStoreConfigured(env)) {
      sendJson(response, 503, { error: "Server archive store is not configured" }, { "cache-control": "no-store" });
      return;
    }
    const body = await readJsonBody(request);
    const workspaceId = archiveWorkspaceId(request, url, body);
    const archive = sanitizeArchive(body);
    const saved = await setServerArchive(archive, env, workspaceId);
    sendJson(response, 200, { ok: true, workspaceId, archive: saved }, { "cache-control": "no-store" });
    return;
  }

  sendJson(response, 405, { error: "Use GET or POST" }, { "cache-control": "no-store" });
}

export function sanitizeArchive(input) {
  const source = isObject(input) ? input : {};
  return {
    walletsText: limitString(source.walletsText, maxWalletsTextLength),
    endDate: isUtcDate(source.endDate) ? source.endDate : "",
    tenDayTarget: limitString(source.tenDayTarget, 64),
    boostOverrides: limitString(source.boostOverrides, maxBonusRulesLength),
    records: Array.isArray(source.records) ? source.records.slice(0, maxRecords).map(sanitizeRecord).filter(Boolean) : [],
    scanHistory: Array.isArray(source.scanHistory) ? source.scanHistory.slice(0, 200).filter(isObject) : [],
    cron: isObject(source.cron) ? source.cron : {},
  };
}

function archiveWorkspaceId(request, url, body) {
  return normalizeWorkspaceId(
    headerValue(request.headers, "x-okx-boost-workspace") ||
      url.searchParams.get("workspace") ||
      body?.workspaceId,
  );
}

function sanitizeRecord(record) {
  if (!isObject(record)) return null;
  const address = String(record.address || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return null;
  return {
    address,
    name: limitString(record.name, 100),
    state: record.state === "error" ? "error" : record.result ? "done" : "idle",
    source: typeof record.source === "string" ? record.source : "archive",
    result: isCalculationResult(record.result) ? record.result : null,
    progress: limitString(record.progress, 500),
    error: limitString(record.error, 500),
    savedAt: typeof record.savedAt === "string" ? record.savedAt : undefined,
  };
}

function isCalculationResult(value) {
  return (
    isObject(value) &&
    Array.isArray(value.dailyRows) &&
    Array.isArray(value.swaps) &&
    Array.isArray(value.txHashes) &&
    typeof value.windowStart === "string" &&
    typeof value.windowEnd === "string"
  );
}

function limitString(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function isUtcDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[name.toLowerCase()] || headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}
