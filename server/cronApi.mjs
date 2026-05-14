import {
  getServerArchive,
  isArchiveStoreConfigured,
  listArchiveWorkspaces,
  normalizeWorkspaceId,
  setServerArchive,
} from "./archiveStore.mjs";
import { isProductionRuntime, requestUrl, sendFeishuText, sendJson, validateAccess } from "./proxy.mjs";
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
    try {
      const result = await runDailyRefresh({
        archive: workspace.archive,
        config,
        onProgress: (message) => {
          console.log(`[daily-refresh][${workspace.provider}:${workspaceId}] ${message}`);
        },
      });

      const operationErrors = [];
      if (!dryRun) {
        try {
          await saveCronWorkspaceArchive(env, workspace, result.updatedArchive);
        } catch (error) {
          operationErrors.push(`归档保存失败：${errorMessage(error)}`);
        }
      }

      const notificationTarget = await resolveNotificationTarget(env, workspace);
      const shouldNotify = shouldNotifyForTarget(result, notificationTarget) || operationErrors.length > 0;
      const notificationText = notificationTextForResult(result, operationErrors);
      let notified = false;
      let notificationProvider = "";
      let notifyError = "";
      if (shouldNotify && !dryRun && notificationTarget?.webhookUrl) {
        try {
          await sendFeishuText(`归档：${workspace.provider}\n数据空间：${workspaceId}\n${notificationText}`, {
            ...config,
            feishuWebhookUrl: notificationTarget.webhookUrl,
            feishuWebhookSecret: notificationTarget.webhookSecret,
          });
          notified = true;
          notificationProvider = notificationTarget.provider;
        } catch (error) {
          notifyError = `飞书发送失败：${errorMessage(error)}`;
        }
      }

      results.push({
        provider: workspace.provider,
        workspaceId,
        result,
        notified,
        notificationProvider,
        shouldNotify,
        error: operationErrors.join("\n"),
        notifyError,
        notificationText,
      });
    } catch (error) {
      const message = errorMessage(error);
      let notified = false;
      let notificationProvider = "";
      let notifyError = "";
      const notificationTarget = await resolveNotificationTarget(env, workspace).catch(() => null);
      const notificationText = `OKX Boost 自动刷新执行失败\n错误：${message}`;
      if (!dryRun && notificationTarget?.webhookUrl) {
        try {
          await sendFeishuText(`归档：${workspace.provider}\n数据空间：${workspaceId}\n${notificationText}`, {
            ...config,
            feishuWebhookUrl: notificationTarget.webhookUrl,
            feishuWebhookSecret: notificationTarget.webhookSecret,
          });
          notified = true;
          notificationProvider = notificationTarget.provider;
        } catch (caught) {
          notifyError = `飞书发送失败：${errorMessage(caught)}`;
        }
      }
      results.push({
        provider: workspace.provider,
        workspaceId,
        result: null,
        notified,
        notificationProvider,
        shouldNotify: Boolean(notificationTarget?.webhookUrl),
        error: message,
        notifyError,
        notificationText,
      });
    }
  }

  const summary = results.reduce(
    (acc, item) => ({
      walletCount: acc.walletCount + resultSummary(item).walletCount,
      succeeded: acc.succeeded + resultSummary(item).succeeded,
      failed: acc.failed + resultSummary(item).failed,
      skipped: acc.skipped + resultSummary(item).skipped,
    }),
    { walletCount: 0, succeeded: 0, failed: 0, skipped: 0 },
  );
  const firstResult = results.find((item) => item.result)?.result;

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
        error: item.error || undefined,
        notifyError: item.notifyError || undefined,
        summary: resultSummary(item),
        forecast: (item.result?.forecastRows || []).map((row) => ({
          snapshotDate: row.snapshotDate,
          atRiskWallets: row.atRiskWallets,
          archivedWallets: row.archivedWallets,
          worstGap: row.worstGap,
          expiredBoostVolume: row.expiredBoostVolume,
        })),
        notificationPreview: dryRun ? item.notificationText : undefined,
      })),
    },
    { "cache-control": "no-store" },
  );
}

function resultSummary(item) {
  if (item.result?.summary) return item.result.summary;
  return { walletCount: 0, succeeded: 0, failed: item.error ? 1 : 0, skipped: 0 };
}

function notificationTextForResult(result, operationErrors) {
  return [result.notificationText, operationErrors.length ? ["运行错误：", ...operationErrors].join("\n") : ""]
    .filter(Boolean)
    .join("\n\n");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

  if (requested && targets.length) return targets;

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

async function resolveNotificationTarget(env, workspace) {
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
  return null;
}

function shouldNotifyForTarget(result, target) {
  if (!target?.webhookUrl) return false;
  return true;
}

function validateCronAccess(request, config, env) {
  const cronSecret = String(env.CRON_SECRET || "").trim();
  const authorization = headerValue(request.headers, "authorization");
  if (cronSecret && authorization === `Bearer ${cronSecret}`) return;

  if (config.accessPassword) {
    validateAccess(request, config, env);
    return;
  }

  if (!cronSecret && !isProductionRuntime(env)) return;

  {
    const error = new Error(cronSecret ? "Cron authorization is missing or invalid." : "CRON_SECRET is not configured.");
    error.statusCode = cronSecret ? 401 : 503;
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
