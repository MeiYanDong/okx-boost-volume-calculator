import { mergeBoostBonuses } from "./boostRules";
import { fetchAnkrAddressOkxHashes } from "./ankr";
import {
  parsedSwapCacheKey,
  readParsedSwapCache,
  readTxHashesCache,
  txHashesCacheKey,
  writeParsedSwapCache,
  writeTxHashesCache,
} from "./cache";
import { isAddress, normalizeAddress } from "./chains";
import { fetchAddressOkxHashes } from "./explorer";
import { parseOkxSwap } from "./parser";
import { RpcClient } from "./rpc";
import { fetchWalletOkxHashesByRpc } from "./rpcScan";
import type {
  CalculateInput,
  CalculationResult,
  ChainConfig,
  ChainId,
  ChainScanSummary,
  DailyBoostRow,
  TxDiscoverySource,
  WalletTransaction,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REORG_SAFETY_BLOCKS = 200;

export type MultiChainCalculateInput = Omit<CalculateInput, "chain" | "previousResult" | "rpcUrl"> & {
  chains: ChainConfig[];
  previousResult?: CalculationResult;
};

export async function calculateBoostVolumeAcrossChains(input: MultiChainCalculateInput): Promise<CalculationResult> {
  const chains = input.chains.length ? input.chains : [];
  if (!chains.length) throw new Error("No chain configured");

  const settled: Array<{ chain: ChainConfig; result: CalculationResult } | { chain: ChainConfig; error: string }> = [];
  for (const chain of chains) {
    try {
      settled.push({
        chain,
        result: await calculateBoostVolume({
          ...input,
          chain,
          previousResult: previousResultForChain(input.previousResult, chain.id),
          onProgress: (message) => input.onProgress?.(`${chain.name}: ${message}`),
        }),
      });
    } catch (error) {
      settled.push({
        chain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const successful = settled.filter((item): item is { chain: ChainConfig; result: CalculationResult } => "result" in item);
  const failed = settled.filter((item): item is { chain: ChainConfig; error: string } => "error" in item);
  if (!successful.length) {
    throw new Error(failed.map((item) => `${item.chain.name}: ${item.error}`).join("\n") || "No chain scan succeeded");
  }
  if (failed.length) {
    throw new Error(`部分链扫描失败，已保留原归档，未写入半成品结果：${failed.map((item) => `${item.chain.name}: ${item.error}`).join("\n")}`);
  }

  const { days } = buildUtcWindow(input.endDate);
  const dailyRows = days.map<DailyBoostRow>((date) => ({
    date,
    txCount: 0,
    boostVolume: 0,
    tradeUsd: 0,
  }));
  const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));
  const swaps = successful.flatMap((item) => item.result.swaps);
  for (const swap of swaps) {
    const row = dailyMap.get(swap.utcDate);
    if (!row) continue;
    row.txCount += swap.status === "counted" ? 1 : 0;
    row.boostVolume += swap.boostVolume;
    row.tradeUsd += swap.tradeUsd || 0;
  }

  const chainScans: Partial<Record<ChainId, ChainScanSummary>> = {};
  for (const { chain, result } of successful) {
    const scan = result.chainScans?.[chain.id];
    chainScans[chain.id] = scan || {
      scannedFromBlock: result.scannedFromBlock,
      scannedToBlock: result.scannedToBlock,
      incrementalFromBlock: result.incrementalFromBlock,
      incrementalNewTxCount: result.incrementalNewTxCount,
      txDiscoverySource: result.txDiscoverySource,
      txHashes: result.txHashes,
    };
  }

  const totalBoostVolume = dailyRows.reduce((sum, row) => sum + row.boostVolume, 0);
  const totalTradeUsd = dailyRows.reduce((sum, row) => sum + row.tradeUsd, 0);
  const primaryScan = chainScans.bsc || Object.values(chainScans)[0];
  const incrementalCounts = Object.values(chainScans)
    .map((scan) => scan?.incrementalNewTxCount)
    .filter((value): value is number => typeof value === "number");

  return {
    windowStart: days[0],
    windowEnd: days[days.length - 1],
    averageBoostVolume: totalBoostVolume / 10,
    totalBoostVolume,
    totalTradeUsd,
    dailyRows: [...dailyRows].reverse(),
    swaps: dedupeSwaps(swaps).sort((a, b) => b.timestamp - a.timestamp),
    warnings: [
      ...successful.flatMap((item) => item.result.warnings),
      ...failed.map((item) => `${item.chain.name} 扫描失败：${item.error}`),
    ],
    txHashes: successful.flatMap((item) => item.result.txHashes.map((hash) => `${item.chain.id}:${hash}`)),
    scannedFromBlock: primaryScan?.scannedFromBlock,
    scannedToBlock: primaryScan?.scannedToBlock,
    incrementalFromBlock: primaryScan?.incrementalFromBlock,
    incrementalNewTxCount: incrementalCounts.length ? incrementalCounts.reduce((sum, value) => sum + value, 0) : undefined,
    txDiscoverySource: successful.length > 1 ? "multi-chain" : successful[0].result.txDiscoverySource,
    chainScans,
  };
}

export async function calculateBoostVolume(input: CalculateInput): Promise<CalculationResult> {
  if (!isAddress(input.address)) {
    throw new Error("请输入有效的钱包地址。");
  }

  const rpc = new RpcClient(input.chain, input.rpcUrl);
  const address = normalizeAddress(input.address);
  const { windowStart, windowEndExclusive, days } = buildUtcWindow(input.endDate);
  const startSeconds = Math.floor(windowStart.getTime() / 1000);
  const endSeconds = Math.floor(windowEndExclusive.getTime() / 1000);
  const boostBonuses = mergeBoostBonuses(input.chain, input.boostBonuses);
  const warnings: string[] = [];

  input.onProgress?.("定位 UTC 窗口对应的区块高度...");
  const [startBlock, latestBlock] = await Promise.all([
    rpc.blockByTimestamp(startSeconds),
    rpc.getBlockNumber(),
  ]);
  const latestTimestamp = await rpc.getBlockTimestamp(latestBlock);
  const endBlock =
    endSeconds > latestTimestamp
      ? latestBlock
      : (await rpc.blockByTimestamp(endSeconds)) - 1;

  if (endSeconds > latestTimestamp) {
    warnings.push(`快照日期 ${input.endDate} 尚未结束，当前结果扫描到最新区块 ${latestBlock}，属于实时预估。`);
  }

  const previousResult = input.previousResult;
  const previousScannedToBlock = previousResult?.scannedToBlock;
  const hasSameWindow =
    previousResult !== undefined &&
    previousResult.windowStart === days[0] &&
    previousResult.windowEnd === days[days.length - 1];
  const hasCompatiblePrevious =
    previousResult !== undefined &&
    previousResult.windowStart <= days[0] &&
    previousResult.windowEnd <= days[days.length - 1] &&
    typeof previousScannedToBlock === "number";
  const canIncrementalRefresh =
    Boolean(input.incrementalRefresh) &&
    !input.forceRefresh &&
    !input.walletTransactions?.length &&
    hasCompatiblePrevious;
  const reorgSafetyBlocks = input.reorgSafetyBlocks ?? DEFAULT_REORG_SAFETY_BLOCKS;
  const scanStartBlock = canIncrementalRefresh
    ? Math.min(endBlock, Math.max(startBlock, previousScannedToBlock! - reorgSafetyBlocks))
    : startBlock;

  if (canIncrementalRefresh && endBlock <= previousScannedToBlock!) {
    if (hasSameWindow) {
      input.onProgress?.(`归档已覆盖最新区块 ${endBlock}，无需读取链上交易`);
      return {
        ...previousResult!,
        warnings,
        scannedFromBlock: previousResult!.scannedFromBlock ?? startBlock,
        scannedToBlock: previousScannedToBlock,
        incrementalFromBlock: endBlock,
        incrementalNewTxCount: 0,
        txDiscoverySource: "archive",
      };
    }
    input.onProgress?.(`归档已覆盖最新区块 ${endBlock}，仅重新汇总滚动窗口`);
  }

  const txHashesKey = txHashesCacheKey({ chain: input.chain, address, startBlock: scanStartBlock, endBlock });
  const canUseTxHashesCache = !input.forceRefresh && !input.walletTransactions?.length;
  const cachedTxHashes = canUseTxHashesCache ? readTxHashesCache(txHashesKey) : null;
  const archiveAlreadyCoversWindow = canIncrementalRefresh && endBlock <= previousScannedToBlock!;
  let discovery: { hashes: string[]; source: TxDiscoverySource };
  try {
    discovery = archiveAlreadyCoversWindow
      ? { hashes: [], source: "archive" as TxDiscoverySource }
      : cachedTxHashes
        ? { hashes: cachedTxHashes, source: "archive" as TxDiscoverySource }
        : await discoverOkxHashes({
          input,
          rpc,
          address,
          startBlock: scanStartBlock,
          endBlock,
          startSeconds,
          endSeconds,
          warnings,
        });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (canReusePreviousChainArchive(input, previousResult, days, endBlock)) {
      input.onProgress?.(`${input.chain.name} 索引不可用，沿用可兼容的原归档`);
      return reusePreviousChainArchive({
        chain: input.chain,
        previousResult: previousResult!,
        days,
        startSeconds,
        endSeconds,
        startBlock,
        scanStartBlock,
        warning: `${input.chain.name} 交易发现失败，已沿用该链可兼容原归档：${message}`,
      });
    }
    throw error;
  }
  const discoveredTxHashes = discovery.hashes;

  if (cachedTxHashes) {
    input.onProgress?.(`命中区块缓存：${cachedTxHashes.length} 个候选 hash`);
  } else if (canUseTxHashesCache) {
    writeTxHashesCache(txHashesKey, discoveredTxHashes);
  }

  const previousWindowSwaps = canIncrementalRefresh
    ? filterSwapsForWindow(dedupeSwaps(previousResult!.swaps), startSeconds, endSeconds)
    : [];
  const previousWindowHashes = previousWindowSwaps.map((swap) => swap.hash);
  const previousHashes = new Set(previousWindowHashes.map((hash) => normalizeAddress(hash)));
  const txHashesToParse = canIncrementalRefresh
    ? discoveredTxHashes.filter((hash) => !previousHashes.has(normalizeAddress(hash)))
    : discoveredTxHashes;
  const txHashes = mergeTxHashes(previousWindowHashes, txHashesToParse);
  const swaps = canIncrementalRefresh
    ? previousWindowSwaps
    : [];

  if (canIncrementalRefresh) {
    input.onProgress?.(
      `增量扫描区块 ${scanStartBlock}-${endBlock}：候选 ${discoveredTxHashes.length} 笔，新增 ${txHashesToParse.length} 笔`,
    );
  }

  const parseErrors: Array<{ hash: string; message: string }> = [];
  for (let index = 0; index < txHashesToParse.length; index += 1) {
    const hash = txHashesToParse[index];
    input.onProgress?.(`解析交易 ${index + 1}/${txHashesToParse.length}: ${hash.slice(0, 10)}...`);
    try {
      const swapKey = parsedSwapCacheKey({ chain: input.chain, address, hash, boostBonuses });
      const cachedSwap = input.forceRefresh ? null : readParsedSwapCache(swapKey);
      const swap =
        cachedSwap ||
        (await parseOkxSwap({
          chain: input.chain,
          rpc,
          hash,
          userAddress: address,
          boostBonuses,
        }));
      if (!cachedSwap) writeParsedSwapCache(swapKey, swap);
      if (swap.timestamp >= startSeconds && swap.timestamp < endSeconds) swaps.push(swap);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(message);
      parseErrors.push({ hash, message });
    }
  }

  const windowSwaps = dedupeSwaps(filterSwapsForWindow(swaps, startSeconds, endSeconds));
  if (parseErrors.length) {
    throw new Error(`交易解析未完成，已保留原归档，未写入残缺交易明细：${formatParseErrors(parseErrors)}`);
  }

  const dailyRows = days.map<DailyBoostRow>((date) => ({
    date,
    txCount: 0,
    boostVolume: 0,
    tradeUsd: 0,
  }));
  const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));
  for (const swap of windowSwaps) {
    const row = dailyMap.get(swap.utcDate);
    if (!row) continue;
    row.txCount += swap.status === "counted" ? 1 : 0;
    row.boostVolume += swap.boostVolume;
    row.tradeUsd += swap.tradeUsd || 0;
  }

  const totalBoostVolume = dailyRows.reduce((sum, row) => sum + row.boostVolume, 0);
  const totalTradeUsd = dailyRows.reduce((sum, row) => sum + row.tradeUsd, 0);

  return {
    windowStart: days[0],
    windowEnd: days[days.length - 1],
    averageBoostVolume: totalBoostVolume / 10,
    totalBoostVolume,
    totalTradeUsd,
    dailyRows: [...dailyRows].reverse(),
    swaps: windowSwaps.sort((a, b) => b.timestamp - a.timestamp),
    warnings,
    txHashes,
    scannedFromBlock: startBlock,
    scannedToBlock: endBlock,
    incrementalFromBlock: canIncrementalRefresh ? scanStartBlock : undefined,
    incrementalNewTxCount: canIncrementalRefresh ? txHashesToParse.length : undefined,
    txDiscoverySource: discovery.source,
    chainScans: {
      [input.chain.id]: {
        scannedFromBlock: startBlock,
        scannedToBlock: endBlock,
        incrementalFromBlock: canIncrementalRefresh ? scanStartBlock : undefined,
        incrementalNewTxCount: canIncrementalRefresh ? txHashesToParse.length : undefined,
        txDiscoverySource: discovery.source,
        txHashes,
      },
    },
  };
}

function previousResultForChain(previousResult: CalculationResult | undefined, chainId: ChainId): CalculationResult | undefined {
  if (!previousResult) return undefined;
  const scan = previousResult.chainScans?.[chainId];
  const swaps = previousResult.swaps.filter((swap) => (swap.chainId || "bsc") === chainId);
  if (!scan && !swaps.length && chainId !== "bsc") return undefined;
  return {
    ...previousResult,
    swaps,
    txHashes: scan?.txHashes || swaps.map((swap) => swap.hash),
    scannedFromBlock: scan?.scannedFromBlock ?? (chainId === "bsc" ? previousResult.scannedFromBlock : undefined),
    scannedToBlock: scan?.scannedToBlock ?? (chainId === "bsc" ? previousResult.scannedToBlock : undefined),
    incrementalFromBlock: scan?.incrementalFromBlock,
    incrementalNewTxCount: scan?.incrementalNewTxCount,
    txDiscoverySource: scan?.txDiscoverySource ?? previousResult.txDiscoverySource,
    chainScans: scan ? { [chainId]: scan } : undefined,
  };
}

function canReusePreviousChainArchive(
  input: CalculateInput,
  previousResult: CalculationResult | undefined,
  days: string[],
  endBlock: number,
): boolean {
  if (!previousResult || !input.incrementalRefresh || input.forceRefresh) return false;
  if (!windowsOverlap(previousResult.windowStart, previousResult.windowEnd, days[0], days[days.length - 1])) return false;
  if (typeof previousResult.scannedToBlock !== "number" || previousResult.scannedToBlock < endBlock) return false;
  const hasChainScan = Boolean(previousResult.chainScans?.[input.chain.id]);
  const hasChainSwaps = previousResult.swaps.some((swap) => (swap.chainId || "bsc") === input.chain.id);
  return hasChainScan || hasChainSwaps;
}

function reusePreviousChainArchive(params: {
  chain: ChainConfig;
  previousResult: CalculationResult;
  days: string[];
  startSeconds: number;
  endSeconds: number;
  startBlock: number;
  scanStartBlock: number;
  warning: string;
}): CalculationResult {
  const scan = params.previousResult.chainScans?.[params.chain.id];
  const windowSwaps = dedupeSwaps(filterSwapsForWindow(params.previousResult.swaps, params.startSeconds, params.endSeconds));
  const txHashes = windowSwaps.map((swap) => swap.hash);
  const dailyRows = buildDailyRows(params.days, windowSwaps);
  const totalBoostVolume = dailyRows.reduce((sum, row) => sum + row.boostVolume, 0);
  const totalTradeUsd = dailyRows.reduce((sum, row) => sum + row.tradeUsd, 0);
  const scannedToBlock = scan?.scannedToBlock ?? params.previousResult.scannedToBlock;
  return {
    ...params.previousResult,
    windowStart: params.days[0],
    windowEnd: params.days[params.days.length - 1],
    averageBoostVolume: totalBoostVolume / 10,
    totalBoostVolume,
    totalTradeUsd,
    dailyRows: [...dailyRows].reverse(),
    swaps: windowSwaps.sort((a, b) => b.timestamp - a.timestamp),
    warnings: [params.warning],
    scannedFromBlock: scan?.scannedFromBlock ?? params.previousResult.scannedFromBlock ?? params.startBlock,
    scannedToBlock,
    incrementalFromBlock: params.scanStartBlock,
    incrementalNewTxCount: 0,
    txDiscoverySource: "archive",
    txHashes,
    chainScans: {
      [params.chain.id]: {
        scannedFromBlock: scan?.scannedFromBlock ?? params.previousResult.scannedFromBlock ?? params.startBlock,
        scannedToBlock,
        incrementalFromBlock: params.scanStartBlock,
        incrementalNewTxCount: 0,
        txDiscoverySource: "archive",
        txHashes,
      },
    },
  };
}

function buildDailyRows(days: string[], swaps: CalculationResult["swaps"]): DailyBoostRow[] {
  const dailyRows = days.map<DailyBoostRow>((date) => ({
    date,
    txCount: 0,
    boostVolume: 0,
    tradeUsd: 0,
  }));
  const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));
  for (const swap of swaps) {
    const row = dailyMap.get(swap.utcDate);
    if (!row) continue;
    row.txCount += swap.status === "counted" ? 1 : 0;
    row.boostVolume += swap.boostVolume;
    row.tradeUsd += swap.tradeUsd || 0;
  }
  return dailyRows;
}

function windowsOverlap(previousStart: string, previousEnd: string, currentStart: string, currentEnd: string): boolean {
  return previousStart <= currentEnd && previousEnd >= currentStart;
}

function mergeTxHashes(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const hash of [...existing, ...incoming]) {
    const normalized = normalizeAddress(hash);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(hash);
  }
  return merged;
}

function filterSwapsForWindow(swaps: CalculationResult["swaps"], startSeconds: number, endSeconds: number): CalculationResult["swaps"] {
  return swaps.filter((swap) => swap.timestamp >= startSeconds && swap.timestamp < endSeconds);
}

function dedupeSwaps(swaps: CalculationResult["swaps"]): CalculationResult["swaps"] {
  const seen = new Set<string>();
  const deduped: CalculationResult["swaps"] = [];
  for (const swap of swaps) {
    const hash = normalizeAddress(swap.hash);
    if (seen.has(hash)) continue;
    seen.add(hash);
    deduped.push(swap);
  }
  return deduped;
}

function formatParseErrors(errors: Array<{ hash: string; message: string }>): string {
  const preview = errors
    .slice(0, 3)
    .map((error) => `${error.hash.slice(0, 10)}... ${error.message}`)
    .join("；");
  return errors.length > 3 ? `${preview}；另 ${errors.length - 3} 笔` : preview;
}

async function discoverOkxHashes(params: {
  input: CalculateInput;
  rpc: RpcClient;
  address: string;
  startBlock: number;
  endBlock: number;
  startSeconds: number;
  endSeconds: number;
  warnings: string[];
}): Promise<{ hashes: string[]; source: TxDiscoverySource }> {
  const indexErrors: string[] = [];
  if (params.input.walletTransactions?.length) {
    params.input.onProgress?.("通过导入的交易记录筛选 OKX Router 交易...");
    const hashes = filterWalletOkxHashes({
      chain: params.input.chain,
      address: params.address,
      startBlock: params.startBlock,
      endBlock: params.endBlock,
      transactions: params.input.walletTransactions,
    });
    if (!hashes.length) {
      params.warnings.push("导入的交易记录没有筛出 OKX Router 候选交易，请确认 CSV 日期范围和钱包地址。");
    }
    return { hashes, source: "import" };
  }

  if (params.input.ankrMultichainRpcUrl && params.input.chain.ankrBlockchain) {
    try {
      params.input.onProgress?.(
        `通过 Ankr Advanced 钱包索引筛选 OKX Router 交易，区块 ${params.startBlock}-${params.endBlock}...`,
      );
      const hashes = await fetchAnkrAddressOkxHashes({
        chain: params.input.chain,
        rpcUrl: params.input.ankrMultichainRpcUrl,
        address: params.address,
        startBlock: params.startBlock,
        endBlock: params.endBlock,
        startSeconds: params.startSeconds,
        endSeconds: params.endSeconds,
        onProgress: params.input.onProgress,
      });
      params.input.onProgress?.(`Ankr 钱包索引完成：${hashes.length} 个候选 OKX hash`);
      return { hashes, source: "ankr" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      indexErrors.push(`Ankr Advanced: ${message}`);
      if (!/Ankr Advanced API is not configured/i.test(message)) {
        params.warnings.push(`Ankr Advanced API 读取失败，已尝试下一个来源：${message}`);
        params.input.onProgress?.("Ankr 钱包索引不可用，改用 Explorer 钱包交易索引...");
      }
    }
  }

  const canUseExplorerIndex =
    Boolean(params.input.chain.explorerApiUrl) &&
    (Boolean(params.input.apiKey) || params.input.chain.explorerApiStyle === "okx-xlayer");
  if (canUseExplorerIndex) {
    try {
      params.input.onProgress?.(
        `通过 Explorer 钱包交易索引筛选 OKX Router 交易，区块 ${params.startBlock}-${params.endBlock}...`,
      );
      const hashes = await fetchAddressOkxHashes({
        chain: params.input.chain,
        address: params.address,
        startBlock: params.startBlock,
        endBlock: params.endBlock,
        apiKey: params.input.apiKey || "__server__",
        serviceAccessPassword: params.input.serviceAccessPassword,
      });
      params.input.onProgress?.(`Explorer 钱包索引完成：${hashes.length} 个候选 OKX hash`);
      return { hashes, source: "explorer" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      indexErrors.push(`Explorer: ${message}`);
      params.warnings.push(`Explorer 钱包索引读取失败，已尝试 RPC 兜底：${message}`);
      params.input.onProgress?.("Explorer 钱包索引不可用，最后兜底使用 RPC Transfer 事件...");
    }
  }

  const rpcFallbackStatus = rpcFallbackStatusFor(params.input, params.startBlock, params.endBlock);
  if (!rpcFallbackStatus.enabled) {
    const detail = indexErrors.length ? ` 当前索引失败：${indexErrors.join("；")}` : "";
    throw new Error(`${params.input.chain.name} 需要可用的钱包交易索引。${detail}。${rpcFallbackStatus.reason}`);
  }

  try {
    params.input.onProgress?.(
      `RPC 兜底：读取公开链上 Transfer 事件，区块 ${params.startBlock}-${params.endBlock}...`,
    );
    const hashes = await fetchWalletOkxHashesByRpc({
      chain: params.input.chain,
      rpc: params.rpc,
      address: params.address,
      startBlock: params.startBlock,
      endBlock: params.endBlock,
      onProgress: params.input.onProgress,
    });
    return { hashes, source: "rpc" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`RPC 公开链上记录读取失败：${message}`);
  }
}

function rpcFallbackStatusFor(input: CalculateInput, startBlock: number, endBlock: number): { enabled: boolean; reason: string } {
  if (input.chain.rpcLogFallbackEnabled !== false) {
    return { enabled: true, reason: "" };
  }
  const blockCount = Math.max(0, endBlock - startBlock + 1);
  const maxBlocks = input.chain.rpcIncrementalFallbackMaxBlocks || 0;
  const canUseIncrementalFallback =
    Boolean(input.chain.rpcIncrementalFallbackEnabled) &&
    Boolean(input.incrementalRefresh) &&
    Boolean(input.previousResult) &&
    maxBlocks > 0 &&
    blockCount <= maxBlocks;
  if (canUseIncrementalFallback) {
    return { enabled: true, reason: "" };
  }
  if (!input.chain.rpcIncrementalFallbackEnabled) {
    return { enabled: false, reason: "该链已禁用 RPC Transfer 日志兜底。" };
  }
  if (!input.incrementalRefresh || !input.previousResult) {
    return { enabled: false, reason: "该链只允许已有归档上的小范围增量 RPC 兜底，避免全窗口慢扫误伤公共节点。" };
  }
  return {
    enabled: false,
    reason: `本次需要兜底扫描 ${blockCount} 个区块，超过该链增量 RPC 上限 ${maxBlocks} 个区块。`,
  };
}

function filterWalletOkxHashes(params: {
  chain: ChainConfig;
  address: string;
  startBlock: number;
  endBlock: number;
  transactions: WalletTransaction[];
}): string[] {
  const address = normalizeAddress(params.address);
  const routers = new Set(params.chain.okxRouters);

  return [
    ...new Set(
      params.transactions
        .filter((tx) => /^0x[a-fA-F0-9]{64}$/.test(tx.hash))
        .filter((tx) => tx.blockNumber === undefined || (tx.blockNumber >= params.startBlock && tx.blockNumber <= params.endBlock))
        .filter((tx) => !tx.from || normalizeAddress(tx.from) === address)
        .filter((tx) => !tx.to || routers.has(normalizeAddress(tx.to)))
        .map((tx) => tx.hash),
    ),
  ];
}

export function buildUtcWindow(endDate: string): {
  windowStart: Date;
  windowEndExclusive: Date;
  days: string[];
} {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) throw new Error("Invalid end date");
  const start = new Date(end.getTime() - 9 * DAY_MS);
  const endExclusive = new Date(end.getTime() + DAY_MS);
  const days = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    return date.toISOString().slice(0, 10);
  });
  return { windowStart: start, windowEndExclusive: endExclusive, days };
}

export function latestSelectableUtcDate(now = new Date()): string {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayUtc).toISOString().slice(0, 10);
}

export function parseBoostOverrides(raw: string): Record<string, number> {
  const entries: Record<string, number> = {};
  for (const line of raw.split(/\n|,/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [address, multiplierRaw] = trimmed.split(/=|:/).map((part) => part.trim());
    if (!/^0x[a-fA-F0-9]{40}$/.test(address || "")) continue;
    const parsed = parseBoostMultiplier(multiplierRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    entries[normalizeAddress(address)] = parsed;
  }
  return entries;
}

function parseBoostMultiplier(value: string | undefined): number {
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

  if (normalized.toLowerCase().endsWith("x")) {
    return Number(normalized.slice(0, -1));
  }

  const parsed = Number(normalized);
  return parsed > 10 ? 1 + parsed / 100 : parsed;
}
