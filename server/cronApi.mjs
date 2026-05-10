import {
  getServerArchive,
  isArchiveStoreConfigured,
  listArchiveWorkspaces,
  normalizeWorkspaceId,
  setServerArchive,
} from "./archiveStore.mjs";
import { requestUrl, sendFeishuText, sendJson, validateAccess } from "./proxy.mjs";
import {
  getSupabaseWorkspaceNotificationTarget,
  getSupabaseWorkspaceArchive,
  isSupabaseConfigured,
  listSupabaseWorkspaceIds,
  saveSupabaseWorkspaceArchive,
} from "./supabaseStore.mjs";

let cronJobModule;

export async function handleDailyRefreshCron(request, response, config, env = process.env) {
  if (!["GET", "POST"].includes(request.method || "")) {
    sendJson(response, 405, { error: "Use GET or POST" }, { "cache-control": "no-store" });
    return;
  }

  validateCronAccess(request, config, env);
  const upstashConfigured = isArchiveStoreConfigured(env);
  const supabaseConfigured = isSupabaseConfigured(env);
  if (!upstashConfigured && !supabaseConfigured) {
    sendJson(response, 503, { error: "No archive store is configured" }, { "cache-control": "no-store" });
    return;
  }

  const url = requestUrl(request);
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";
  const requestedWorkspace = url.searchParams.get("workspace") || headerValue(request.headers, "x-okx-boost-workspace");
  const workspaces = await resolveCronWorkspaces(env, requestedWorkspace, { upstashConfigured, supabaseConfigured });
  const { runDailyRefresh } = await loadCronJob();
  const results = [];

  for (const workspace of workspaces) {
    const workspaceId = workspace.workspaceId;
    const result = await runDailyRefresh({
      archive: workspace.archive,
      config,
      onProgress: (message) => {
        console.log(`[daily-refresh][${workspace.provider}:${workspaceId}] ${message}`);
      },
    });

    if (!dryRun) {
      await saveCronWorkspaceArchive(env, workspace, result.updatedArchive);
    }

    const notificationTarget = await resolveNotificationTarget(env, workspace, config);
    const shouldNotify = shouldNotifyForTarget(result, notificationTarget);
    let notified = false;
    let notificationProvider = "";
    if (shouldNotify && !dryRun) {
      await sendFeishuText(
        `归档：${workspace.provider}\n数据空间：${workspaceId}\n${result.notificationText}`,
        {
          ...config,
          feishuWebhookUrl: notificationTarget.webhookUrl,
          feishuWebhookSecret: notificationTarget.webhookSecret,
        },
      );
      notified = true;
      notificationProvider = notificationTarget.provider;
    }

    results.push({ provider: workspace.provider, workspaceId, result, notified, notificationProvider, shouldNotify });
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
      shouldNotify: results.some((item) => item.shouldNotify),
      summary,
      workspaces: results.map((item) => ({
        provider: item.provider,
        workspaceId: item.workspaceId,
        notified: item.notified,
        notificationProvider: item.notificationProvider || undefined,
        shouldNotify: item.shouldNotify,
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

async function resolveCronWorkspaces(env, requestedWorkspace, config) {
  const targets = [];
  const requested = requestedWorkspace ? String(requestedWorkspace).trim() : "";

  if (config.supabaseConfigured) {
    const ids = requested ? [requested] : await listSupabaseWorkspaceIds(env);
    for (const workspaceId of ids) {
      const resolved = await getSupabaseWorkspaceArchive(env, workspaceId).catch(() => null);
      if (resolved) targets.push({ provider: "supabase", workspaceId: resolved.workspaceId, archive: resolved.archive });
    }
  }

  if (config.upstashConfigured) {
    const ids = requested ? [normalizeWorkspaceId(requested)] : await listArchiveWorkspaces(env);
    for (const workspaceId of ids) {
      const archive = await getServerArchive(env, workspaceId);
      if (archive) targets.push({ provider: "upstash", workspaceId, archive });
    }
  }

  return targets;
}

async function saveCronWorkspaceArchive(env, workspace, archive) {
  if (workspace.provider === "supabase") {
    await saveSupabaseWorkspaceArchive(env, workspace.workspaceId, archive);
    return;
  }
  await setServerArchive(archive, env, workspace.workspaceId);
}

async function resolveNotificationTarget(env, workspace, config) {
  if (workspace.provider === "supabase") {
    const target = await getSupabaseWorkspaceNotificationTarget(env, workspace.workspaceId).catch(() => null);
    if (target?.enabled) {
      return {
        provider: "supabase",
        webhookUrl: target.webhookUrl,
        webhookSecret: target.webhookSecret,
        notifyFutureDays: target.notifyFutureDays,
      };
    }
  }
  return {
    provider: "global",
    webhookUrl: config.feishuWebhookUrl,
    webhookSecret: config.feishuWebhookSecret,
    notifyFutureDays: 3,
  };
}

function shouldNotifyForTarget(result, target) {
  if (!target?.webhookUrl) return false;
  if (result.summary.failed > 0) return true;
  const horizon = Number.isInteger(target.notifyFutureDays) ? target.notifyFutureDays : 3;
  const forecastRows = Array.isArray(result.forecastRows) ? result.forecastRows.slice(0, horizon + 1) : [];
  return forecastRows.some((row) => row.atRiskWallets > 0);
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
