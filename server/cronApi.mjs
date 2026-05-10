import {
  getServerArchive,
  isArchiveStoreConfigured,
  listArchiveWorkspaces,
  normalizeWorkspaceId,
  setServerArchive,
} from "./archiveStore.mjs";
import { requestUrl, sendFeishuText, sendJson, validateAccess } from "./proxy.mjs";

let cronJobModule;

export async function handleDailyRefreshCron(request, response, config, env = process.env) {
  if (!["GET", "POST"].includes(request.method || "")) {
    sendJson(response, 405, { error: "Use GET or POST" }, { "cache-control": "no-store" });
    return;
  }

  validateCronAccess(request, config, env);
  if (!isArchiveStoreConfigured(env)) {
    sendJson(response, 503, { error: "Server archive store is not configured" }, { "cache-control": "no-store" });
    return;
  }

  const url = requestUrl(request);
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";
  const requestedWorkspace = url.searchParams.get("workspace") || headerValue(request.headers, "x-okx-boost-workspace");
  const workspaces = requestedWorkspace ? [normalizeWorkspaceId(requestedWorkspace)] : await listArchiveWorkspaces(env);
  const { runDailyRefresh } = await loadCronJob();
  const results = [];

  for (const workspaceId of workspaces) {
    const archive = await getServerArchive(env, workspaceId);
    const result = await runDailyRefresh({
      archive,
      config,
      onProgress: (message) => {
        console.log(`[daily-refresh][${workspaceId}] ${message}`);
      },
    });

    if (!dryRun) {
      await setServerArchive(result.updatedArchive, env, workspaceId);
    }

    let notified = false;
    if (result.shouldNotify && !dryRun) {
      await sendFeishuText(`数据空间：${workspaceId}\n${result.notificationText}`, config);
      notified = true;
    }

    results.push({ workspaceId, result, notified });
  }

  const summary = results.reduce(
    (acc, item) => ({
      walletCount: acc.walletCount + item.result.summary.walletCount,
      succeeded: acc.succeeded + item.result.summary.succeeded,
      failed: acc.failed + item.result.summary.failed,
      skipped: acc.skipped + item.result.summary.skipped,
    }),
    { walletCount: 0, succeeded: 0, failed: 0, skipped: 0 },
  );
  const firstResult = results[0]?.result;

  sendJson(
    response,
    200,
    {
      ok: true,
      dryRun,
      workspaceCount: results.length,
      notified: results.some((item) => item.notified),
      snapshotDate: firstResult?.snapshotDate || null,
      shouldNotify: results.some((item) => item.result.shouldNotify),
      summary,
      workspaces: results.map((item) => ({
        workspaceId: item.workspaceId,
        notified: item.notified,
        shouldNotify: item.result.shouldNotify,
        summary: item.result.summary,
        forecast: item.result.forecastRows.map((row) => ({
          snapshotDate: row.snapshotDate,
          atRiskWallets: row.atRiskWallets,
          archivedWallets: row.archivedWallets,
          worstGap: row.worstGap,
          expiredBoostVolume: row.expiredBoostVolume,
        })),
        notificationPreview: dryRun ? item.result.notificationText : undefined,
      })),
    },
    { "cache-control": "no-store" },
  );
}

function validateCronAccess(request, config, env) {
  const cronSecret = String(env.CRON_SECRET || "").trim();
  const authorization = headerValue(request.headers, "authorization");
  if (cronSecret && authorization === `Bearer ${cronSecret}`) return;

  if (config.accessPassword) {
    validateAccess(request, config);
    return;
  }

  if (!cronSecret) return;

  {
    const error = new Error("Cron authorization is missing or invalid.");
    error.statusCode = 401;
    throw error;
  }
}

async function loadCronJob() {
  if (!cronJobModule) {
    try {
      cronJobModule = await import("../.server/cronJob.mjs");
    } catch {
      throw new Error("Cron job bundle is missing. Run npm run build:server before using /api/cron/daily-refresh locally.");
    }
  }
  return cronJobModule;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[name.toLowerCase()] || headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}
