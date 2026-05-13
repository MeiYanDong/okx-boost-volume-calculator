import { BSC_CHAIN, CHAINS, chainById, isAddress, normalizeAddress } from "../src/lib/chains";
import { buildUtcWindow, calculateBoostVolumeAcrossChains } from "../src/lib/calculator";
import { formatUsd } from "../src/lib/format";
import { repriceCalculationResult } from "../src/lib/reprice";
import type { CalculationResult, ChainConfig, ParsedSwap } from "../src/lib/types";

const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/g;
const DEFAULT_TEN_DAY_TARGET = 5000;
const CRON_SCAN_CONCURRENCY = 1;
const MAX_SCAN_HISTORY_RECORDS = 200;
const SNAPSHOT_CONFIRM_TIME_LABEL = "08:00";

type ProxyConfig = {
  bscRpcUrl?: string;
  xlayerRpcUrl?: string;
  ankrMultichainRpcUrl?: string;
  etherscanApiKey?: string;
  etherscanApiUrl?: string;
};

type ServerArchiveRecord = {
  address: string;
  name?: string;
  state?: string;
  source?: string;
  result?: CalculationResult | null;
  progress?: string;
  error?: string;
  savedAt?: string;
};

type ServerArchive = {
  walletsText?: string;
  endDate?: string;
  tenDayTarget?: string;
  boostOverrides?: string;
  records?: ServerArchiveRecord[];
  scanHistory?: Array<Record<string, unknown>>;
  cron?: Record<string, unknown>;
};

type WalletListEntry = {
  address: string;
  name: string;
};

type ParsedWalletList = {
  entries: WalletListEntry[];
};

type ScopedBonusRules = {
  scoped: Record<string, number>;
  global: Record<string, number>;
};

type SnapshotForecastWalletRow = {
  address: string;
  name: string;
  boostVolume: number;
  gap: number;
  expiredBoostVolume: number;
  targetMet: boolean;
};

type SnapshotForecastRow = {
  snapshotDate: string;
  runLabel: string;
  windowStart: string;
  windowEnd: string;
  expiredDate: string;
  archivedWallets: number;
  targetMetWallets: number;
  atRiskWallets: number;
  totalBoostVolume: number;
  expiredBoostVolume: number;
  worstGap: number;
  walletRows: SnapshotForecastWalletRow[];
};

type CronRunResult = {
  snapshotDate: string;
  updatedArchive: ServerArchive;
  shouldNotify: boolean;
  notificationText: string;
  forecastRows: SnapshotForecastRow[];
  summary: {
    walletCount: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
};

export async function runDailyRefresh(params: {
  archive: ServerArchive | null;
  config: ProxyConfig;
  now?: Date;
  onProgress?: (message: string) => void;
}): Promise<CronRunResult> {
  const archive = params.archive || {};
  const startedAt = new Date().toISOString();
  const snapshotDate = cronSnapshotDate(params.now || new Date());
  const targetTotal = parseOptionalAmount(archive.tenDayTarget) || DEFAULT_TEN_DAY_TARGET;
  const entries = walletEntriesForArchive(archive);
  const previousByAddress = new Map((archive.records || []).map((record) => [normalizeAddress(record.address), record]));
  const chains = buildServerChains(params.config);
  const nextRecords: ServerArchiveRecord[] = [];
  const failures: Array<{ address: string; name: string; error: string }> = [];
  const scanHistory = Array.isArray(archive.scanHistory) ? [...archive.scanHistory] : [];

  await runWithConcurrency(entries, CRON_SCAN_CONCURRENCY, async (entry) => {
    const previous = previousByAddress.get(entry.address);
    const startedAtMs = Date.now();
    params.onProgress?.(`刷新 ${entry.name || entry.address} ${snapshotDate}`);
    try {
      const result = await calculateBoostVolumeAcrossChains({
        address: entry.address,
        endDate: snapshotDate,
        chains,
        ankrMultichainRpcUrl: params.config.ankrMultichainRpcUrl,
        apiKey: params.config.etherscanApiKey,
        boostBonuses: {},
        incrementalRefresh: true,
        previousResult: previous?.result || undefined,
        onProgress: (message) => params.onProgress?.(`${entry.name || entry.address}: ${message}`),
      });
      const savedAt = new Date().toISOString();
      nextRecords.push({
        address: entry.address,
        name: entry.name,
        state: "done",
        source: "fresh",
        result,
        progress:
          typeof result.incrementalNewTxCount === "number"
            ? `自动增量刷新完成，新增 ${result.incrementalNewTxCount} 笔 OKX 交易`
            : "自动刷新完成",
        error: "",
        savedAt,
      });
      scanHistory.unshift(buildScanHistoryRecord(entry, snapshotDate, startedAt, savedAt, Date.now() - startedAtMs, result));
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      failures.push({ address: entry.address, name: entry.name, error });
      const savedAt = new Date().toISOString();
      nextRecords.push({
        address: entry.address,
        name: entry.name,
        state: "error",
        source: previous?.source || "archive",
        result: previous?.result || null,
        progress: "自动刷新失败",
        error,
        savedAt: previous?.savedAt,
      });
      scanHistory.unshift(buildScanHistoryErrorRecord(entry, snapshotDate, startedAt, savedAt, Date.now() - startedAtMs, error));
    }
  });

  const nextRecordsByAddress = new Map(nextRecords.map((record) => [record.address, record]));
  const orderedRecords = entries.map((entry) => nextRecordsByAddress.get(entry.address)).filter(Boolean) as ServerArchiveRecord[];
  const adjustedRecords = orderedRecords.map((record) => ({
    ...record,
    result: record.result ? applyBonusRules(record.result, archive.boostOverrides || "", record.address) : null,
  }));
  const forecastRows = buildSnapshotForecastRows(adjustedRecords, snapshotDate, targetTotal);
  const firstRiskRow = forecastRows.find((row) => row.atRiskWallets > 0) || null;
  const shouldNotify = Boolean(firstRiskRow || failures.length);
  const notificationText = shouldNotify
    ? buildCronFeishuMessage({
        snapshotDate,
        targetTotal,
        firstRiskRow,
        failures,
        succeeded: orderedRecords.length - failures.length,
        walletCount: entries.length,
      })
    : "";
  const finishedAt = new Date().toISOString();
  const updatedArchive: ServerArchive = {
    ...archive,
    walletsText: archive.walletsText || walletTextFromEntries(entries),
    endDate: snapshotDate,
    tenDayTarget: archive.tenDayTarget || String(DEFAULT_TEN_DAY_TARGET),
    records: orderedRecords,
    scanHistory: scanHistory.slice(0, MAX_SCAN_HISTORY_RECORDS),
    cron: {
      lastRunAt: finishedAt,
      lastSnapshotDate: snapshotDate,
      lastWalletCount: entries.length,
      lastSucceeded: orderedRecords.length - failures.length,
      lastFailed: failures.length,
      lastShouldNotify: shouldNotify,
    },
  };

  return {
    snapshotDate,
    updatedArchive,
    shouldNotify,
    notificationText,
    forecastRows,
    summary: {
      walletCount: entries.length,
      succeeded: orderedRecords.length - failures.length,
      failed: failures.length,
      skipped: 0,
    },
  };
}

export function cronSnapshotDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10);
}

function buildServerChains(config: ProxyConfig): ChainConfig[] {
  return CHAINS.map((chain) => {
    if (chain.id === "bsc") {
      return {
        ...BSC_CHAIN,
        rpcUrl: config.bscRpcUrl || BSC_CHAIN.rpcUrl,
        explorerApiUrl: config.etherscanApiUrl || BSC_CHAIN.explorerApiUrl,
      };
    }
    if (chain.id === "xlayer") {
      return {
        ...chain,
        rpcUrl: config.xlayerRpcUrl || chain.rpcUrl,
      };
    }
    return chain;
  });
}

function walletEntriesForArchive(archive: ServerArchive): WalletListEntry[] {
  const parsed = parseWalletList(archive.walletsText || "");
  if (parsed.entries.length) return parsed.entries;
  return (archive.records || [])
    .filter((record) => isAddress(record.address))
    .map((record, index) => ({
      address: normalizeAddress(record.address),
      name: record.name || `Wallet-${String(index + 1).padStart(2, "0")}`,
    }));
}

function parseWalletList(raw: string): ParsedWalletList {
  const seen = new Set<string>();
  const entries: WalletListEntry[] = [];

  for (const rawLine of raw.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const matches = [...line.matchAll(ADDRESS_PATTERN)];
    for (const match of matches) {
      const address = normalizeAddress(match[0]);
      if (seen.has(address)) continue;
      seen.add(address);
      entries.push({
        address,
        name: cleanWalletName(line.replace(ADDRESS_PATTERN, " ")),
      });
    }
  }

  return { entries };
}

function cleanWalletName(raw: string): string {
  return raw.replace(/[=：:|,，;；]+/g, " ").replace(/\s+/g, " ").trim();
}

function walletTextFromEntries(entries: WalletListEntry[]): string {
  return entries.map((entry) => (entry.name ? `${entry.name} ${entry.address}` : entry.address)).join("\n");
}

function buildScanHistoryRecord(
  entry: WalletListEntry,
  snapshotDate: string,
  startedAt: string,
  endedAt: string,
  durationMs: number,
  result: CalculationResult,
): Record<string, unknown> {
  return {
    id: `cron:${entry.address}:${snapshotDate}:${startedAt}`,
    address: entry.address,
    snapshotDate,
    mode: "refresh",
    status: "success",
    startedAt,
    endedAt,
    durationMs,
    source: result.txDiscoverySource,
    scannedFromBlock: result.scannedFromBlock,
    scannedToBlock: result.scannedToBlock,
    incrementalFromBlock: result.incrementalFromBlock,
    newTxCount: result.incrementalNewTxCount,
    totalTxCount: result.swaps.length,
    warningCount: result.warnings.length,
  };
}

function buildScanHistoryErrorRecord(
  entry: WalletListEntry,
  snapshotDate: string,
  startedAt: string,
  endedAt: string,
  durationMs: number,
  error: string,
): Record<string, unknown> {
  return {
    id: `cron:${entry.address}:${snapshotDate}:${startedAt}`,
    address: entry.address,
    snapshotDate,
    mode: "refresh",
    status: "error",
    startedAt,
    endedAt,
    durationMs,
    error,
  };
}

function buildSnapshotForecastRows(
  records: ServerArchiveRecord[],
  baseSnapshotDate: string,
  targetTotalPerWallet: number,
): SnapshotForecastRow[] {
  return Array.from({ length: 4 }, (_, offset) => {
    const snapshotDate = addUtcDays(baseSnapshotDate, offset);
    const { days } = buildUtcWindow(snapshotDate);
    const daySet = new Set(days);
    const expiredDate = addUtcDays(snapshotDate, -10);
    const walletRows = records
      .map((record, index) => {
        if (!record.result) return null;
        const boostVolume = record.result.dailyRows.reduce(
          (sum, row) => (daySet.has(row.date) ? sum + row.boostVolume : sum),
          0,
        );
        const expiredBoostVolume = record.result.dailyRows.find((row) => row.date === expiredDate)?.boostVolume || 0;
        const gap = Math.max(0, targetTotalPerWallet - boostVolume);
        return {
          address: record.address,
          name: walletDisplayName(record, index),
          boostVolume,
          gap,
          expiredBoostVolume,
          targetMet: boostVolume >= targetTotalPerWallet,
        };
      })
      .filter((row): row is SnapshotForecastWalletRow => Boolean(row))
      .sort((a, b) => {
        if (a.targetMet !== b.targetMet) return a.targetMet ? 1 : -1;
        if (b.gap !== a.gap) return b.gap - a.gap;
        return a.boostVolume - b.boostVolume;
      });

    const archivedWallets = walletRows.length;
    const atRiskWallets = walletRows.filter((row) => !row.targetMet).length;
    const targetMetWallets = archivedWallets - atRiskWallets;
    const totalBoostVolume = walletRows.reduce((sum, row) => sum + row.boostVolume, 0);
    const expiredBoostVolume = walletRows.reduce((sum, row) => sum + row.expiredBoostVolume, 0);
    const worstGap = walletRows.reduce((max, row) => Math.max(max, row.gap), 0);

    return {
      snapshotDate,
      runLabel: `${formatToolbarDate(addUtcDays(snapshotDate, 1))} ${SNAPSHOT_CONFIRM_TIME_LABEL}`,
      windowStart: days[0],
      windowEnd: days[days.length - 1],
      expiredDate,
      archivedWallets,
      targetMetWallets,
      atRiskWallets,
      totalBoostVolume,
      expiredBoostVolume,
      worstGap,
      walletRows,
    };
  });
}

function buildCronFeishuMessage(params: {
  snapshotDate: string;
  targetTotal: number;
  firstRiskRow: SnapshotForecastRow | null;
  failures: Array<{ address: string; name: string; error: string }>;
  succeeded: number;
  walletCount: number;
}): string {
  const lines = [
    "OKX Boost 自动快照预警",
    `快照日：${params.snapshotDate}`,
    `确认时间：${formatToolbarDate(addUtcDays(params.snapshotDate, 1))} ${SNAPSHOT_CONFIRM_TIME_LABEL} 北京时间`,
    `单钱包目标：${formatUsd(params.targetTotal)}`,
    `自动刷新：成功 ${params.succeeded}/${params.walletCount}，失败 ${params.failures.length}`,
  ];

  if (params.firstRiskRow) {
    const riskWallets = params.firstRiskRow.walletRows
      .filter((wallet) => !wallet.targetMet)
      .slice(0, 8)
      .map(
        (wallet, index) =>
          `${index + 1}. ${wallet.name} ${shortAddress(wallet.address)}：当前 ${formatUsd(wallet.boostVolume)}，差 ${formatUsd(wallet.gap)}`,
      );
    lines.push(
      "",
      "风险快照：",
      `确认时间：${params.firstRiskRow.runLabel} 北京时间`,
      `统计窗口：${params.firstRiskRow.windowStart} 至 ${params.firstRiskRow.windowEnd}`,
      `风险钱包：${params.firstRiskRow.atRiskWallets}/${params.firstRiskRow.archivedWallets}`,
      `最大差额：${formatUsd(params.firstRiskRow.worstGap)}`,
      `到期交易量：${formatUsd(params.firstRiskRow.expiredBoostVolume)}`,
      "",
      "需要处理的钱包：",
      riskWallets.length ? riskWallets.join("\n") : "暂无",
    );
  }

  if (params.failures.length) {
    lines.push(
      "",
      "刷新失败的钱包：",
      params.failures
        .slice(0, 8)
        .map((failure, index) => `${index + 1}. ${failure.name || shortAddress(failure.address)} ${shortAddress(failure.address)}：${failure.error}`)
        .join("\n"),
    );
  }

  return lines.join("\n");
}

function applyBonusRules(result: CalculationResult, bonusRules: string, walletAddress: string): CalculationResult {
  const bonuses = parseScopedBonusRules(bonusRules);
  const wallet = normalizeAddress(walletAddress);
  return repriceCalculationResult(result, (swap) => scopedBonusMultiplierForSwap(swap, bonuses, wallet));
}

function scopedBonusMultiplierForSwap(swap: ParsedSwap, rules: ScopedBonusRules, wallet: string): number {
  const inputBonus = scopedBonusFor(rules, wallet, swap.utcDate, swap.inputToken.address);
  const outputBonus = scopedBonusFor(rules, wallet, swap.utcDate, swap.outputToken.address);
  const chainBonus = chainById(swap.chainId).chainBonusMultiplier || 1;
  return Math.max(inputBonus, outputBonus, 1) * chainBonus;
}

function scopedBonusFor(rules: ScopedBonusRules, wallet: string, date: string, address: string): number {
  const token = normalizeAddress(address);
  return rules.scoped[scopedBonusKey(wallet, date, token)] || rules.global[token] || 1;
}

function scopedBonusKey(wallet: string, date: string, address: string): string {
  return [normalizeAddress(wallet), date, normalizeAddress(address)].join("|");
}

function parseScopedBonusRules(raw: string): ScopedBonusRules {
  const rules: ScopedBonusRules = { scoped: {}, global: {} };
  for (const line of raw.split(/\n|,/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [leftRaw, multiplierRaw] = trimmed.split(/=|:/).map((part) => part.trim());
    const multiplier = parseBonusMultiplierInput(multiplierRaw);
    if (!Number.isFinite(multiplier) || multiplier <= 0) continue;

    const parts = (leftRaw || "").split("|").map((part) => part.trim());
    if (parts.length === 3 && isAddress(parts[0]) && isUtcDate(parts[1]) && isAddress(parts[2])) {
      rules.scoped[scopedBonusKey(parts[0], parts[1], parts[2])] = multiplier;
      continue;
    }

    if (parts.length === 1 && isAddress(parts[0])) {
      rules.global[normalizeAddress(parts[0])] = multiplier;
    }
  }
  return rules;
}

function parseBonusMultiplierInput(value: string | undefined): number {
  const normalized = (value || "").trim().replace(/\s+/g, "");
  if (!normalized) return Number.NaN;
  if (normalized.endsWith("%")) {
    const percentage = Number(normalized.slice(0, -1).replace(/^\+/, ""));
    return Number.isFinite(percentage) ? 1 + percentage / 100 : Number.NaN;
  }
  if (normalized.startsWith("+")) {
    const percentage = Number(normalized.slice(1));
    return Number.isFinite(percentage) ? 1 + percentage / 100 : Number.NaN;
  }
  if (normalized.toLowerCase().endsWith("x")) return Number(normalized.slice(0, -1));
  const parsed = Number(normalized);
  return parsed > 10 ? 1 + parsed / 100 : parsed;
}

function parseOptionalAmount(raw: string | undefined): number | null {
  const normalized = String(raw || "").trim().replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function addUtcDays(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatToolbarDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}/${month}/${day}`;
}

function walletDisplayName(record: ServerArchiveRecord, index?: number): string {
  if (record.name) return record.name;
  if (typeof index === "number") return index === 0 ? "MyanDong" : `Wallet-${String(index + 1).padStart(2, "0")}`;
  return shortAddress(record.address);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isUtcDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex], currentIndex);
      }
    }),
  );
}
