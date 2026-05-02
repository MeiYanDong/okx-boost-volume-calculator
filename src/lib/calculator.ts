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
import type { CalculateInput, CalculationResult, ChainConfig, DailyBoostRow, WalletTransaction } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const txHashesKey = txHashesCacheKey({ chain: input.chain, address, startBlock, endBlock });
  const canUseTxHashesCache = !input.walletTransactions?.length;
  const cachedTxHashes = canUseTxHashesCache ? readTxHashesCache(txHashesKey) : null;
  const txHashes =
    cachedTxHashes ||
    (await discoverOkxHashes({
      input,
      rpc,
      address,
      startBlock,
      endBlock,
      startSeconds,
      endSeconds,
      warnings,
    }));

  if (cachedTxHashes) {
    input.onProgress?.(`命中窗口缓存：${cachedTxHashes.length} 个候选 hash`);
  } else if (canUseTxHashesCache) {
    writeTxHashesCache(txHashesKey, txHashes);
  }

  const swaps = [];
  for (let index = 0; index < txHashes.length; index += 1) {
    const hash = txHashes[index];
    input.onProgress?.(`解析交易 ${index + 1}/${txHashes.length}: ${hash.slice(0, 10)}...`);
    try {
      const swapKey = parsedSwapCacheKey({ chain: input.chain, address, hash, boostBonuses });
      const cachedSwap = readParsedSwapCache(swapKey);
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
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

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

  const totalBoostVolume = dailyRows.reduce((sum, row) => sum + row.boostVolume, 0);
  const totalTradeUsd = dailyRows.reduce((sum, row) => sum + row.tradeUsd, 0);

  return {
    windowStart: days[0],
    windowEnd: days[days.length - 1],
    averageBoostVolume: totalBoostVolume / 10,
    totalBoostVolume,
    totalTradeUsd,
    dailyRows: [...dailyRows].reverse(),
    swaps: swaps.sort((a, b) => b.timestamp - a.timestamp),
    warnings,
    txHashes,
  };
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
}): Promise<string[]> {
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
    return hashes;
  }

  if (params.input.ankrMultichainRpcUrl) {
    try {
      params.input.onProgress?.("通过 Ankr Advanced API 钱包索引筛选 OKX Router 交易...");
      return await fetchAnkrAddressOkxHashes({
        chain: params.input.chain,
        rpcUrl: params.input.ankrMultichainRpcUrl,
        address: params.address,
        startBlock: params.startBlock,
        endBlock: params.endBlock,
        startSeconds: params.startSeconds,
        endSeconds: params.endSeconds,
        onProgress: params.input.onProgress,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.warnings.push(`Ankr Advanced API 读取失败，已尝试下一个来源：${message}`);
    }
  }

  if (params.input.apiKey) {
    try {
      params.input.onProgress?.("通过钱包交易记录索引筛选 OKX Router 交易...");
      return await fetchAddressOkxHashes({
        chain: params.input.chain,
        address: params.address,
        startBlock: params.startBlock,
        endBlock: params.endBlock,
        apiKey: params.input.apiKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.warnings.push(`钱包交易记录索引读取失败，已改用 RPC 公开链上记录：${message}`);
    }
  }

  try {
    params.input.onProgress?.("通过 RPC 读取公开链上记录...");
    return await fetchWalletOkxHashesByRpc({
      chain: params.input.chain,
      rpc: params.rpc,
      address: params.address,
      startBlock: params.startBlock,
      endBlock: params.endBlock,
      onProgress: params.input.onProgress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`RPC 公开链上记录读取失败：${message}`);
  }
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
