import { getUserArchive } from "./supabaseStore.mjs";

let cronJobModule;

export async function buildFeishuRealDataTestMessage({ env = process.env, user, config, notifyFutureDays = 3 }) {
  const { workspaceId, archive } = await getUserArchive(env, user);
  const { runDailyRefresh } = await loadCronJob();
  const result = await runDailyRefresh({
    archive,
    config,
    onProgress: (message) => console.log(`[feishu-test][supabase:${workspaceId}] ${message}`),
  });
  const horizon = clampInteger(notifyFutureDays, 0, 30, 3);
  const forecastRows = Array.isArray(result.forecastRows) ? result.forecastRows.slice(0, horizon + 1) : [];
  const firstRiskRow = forecastRows.find((row) => Number(row.atRiskWallets || 0) > 0) || null;
  const focusRow = firstRiskRow || forecastRows[0] || null;
  const status = result.summary.failed > 0 ? "有刷新失败" : firstRiskRow ? "存在达标风险" : "当前无风险";
  const targetTotal = parsePositiveNumber(archive?.tenDayTarget) || 5000;

  const lines = [
    "OKX Boost 真实数据测试",
    "说明：这是测试发送，已读取当前账号云端归档，并执行一次每日自动刷新演练；本次不会写入归档。",
    `结果：${status}`,
    `数据空间：${workspaceId}`,
    `快照日：${result.snapshotDate}`,
    `单钱包目标：${formatUsd(targetTotal)}`,
    `刷新演练：成功 ${result.summary.succeeded}/${result.summary.walletCount}，失败 ${result.summary.failed}`,
    `风险判断：当前快照 + 未来 ${horizon} 天`,
  ];

  if (forecastRows.length) {
    lines.push("", "预测摘要：", ...forecastRows.slice(0, 4).map(formatForecastRow));
  }

  if (focusRow?.walletRows?.length) {
    const walletRows = focusRow.walletRows
      .slice(0, 8)
      .map(
        (wallet, index) =>
          `${index + 1}. ${wallet.name || shortAddress(wallet.address)} ${shortAddress(wallet.address)}：${formatUsd(
            wallet.boostVolume,
          )}${wallet.targetMet ? "，已达标" : `，差 ${formatUsd(wallet.gap)}`}`,
      );
    lines.push("", firstRiskRow ? "风险钱包样本：" : "钱包样本：", ...walletRows);
  }

  if (result.notificationText) {
    lines.push("", "按正式规则会发送的预警正文：", result.notificationText);
  } else {
    lines.push("", "按正式规则：当前不会自动发送风险提醒。");
  }

  return {
    text: truncateFeishuText(lines.join("\n")),
    workspaceId,
    snapshotDate: result.snapshotDate,
    summary: result.summary,
    shouldNotify: Boolean(result.shouldNotify),
  };
}

async function loadCronJob() {
  if (!cronJobModule) {
    try {
      cronJobModule = await import("../.server/cronJob.mjs");
    } catch {
      throw new Error("Cron job bundle is missing. Run npm run build:server before using real-data Feishu test.");
    }
  }
  return cronJobModule;
}

function formatForecastRow(row) {
  return [
    `- ${row.snapshotDate}`,
    `风险 ${Number(row.atRiskWallets || 0)}/${Number(row.archivedWallets || 0)}`,
    `总 Boost ${formatUsd(row.totalBoostVolume)}`,
    `到期 ${formatUsd(row.expiredBoostVolume)}`,
    `最大差额 ${formatUsd(row.worstGap)}`,
  ].join("，");
}

function formatUsd(value) {
  const amount = Number(value || 0);
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortAddress(address) {
  const value = String(address || "");
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function parsePositiveNumber(value) {
  const number = Number(String(value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function truncateFeishuText(text) {
  if (text.length <= 3900) return text;
  return `${text.slice(0, 3860)}\n\n...已截断，完整数据请在 OKX Boost 页面查看。`;
}
