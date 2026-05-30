import { normalizeAddress, tokenSymbolFromConfig, withTokenGroup } from "./chains";
import { serverAccessHeaders } from "./serverAccess";
import type { ChainConfig, TokenMeta } from "./types";

const RPC_REQUEST_TIMEOUT_MS = 25_000;
const RPC_MAX_RETRIES = 6;
const RPC_RETRY_BACKOFF_MS = 1_250;
const LATEST_BLOCK_CACHE_MS = 15_000;

const globalBlockTimestampCaches = new Map<string, Map<number, number>>();
const globalTimestampBlockCaches = new Map<string, Map<number, number>>();
const globalLatestBlockCache = new Map<string, { blockNumber: number; expiresAt: number }>();

type RpcBlock = {
  number: string;
  timestamp: string;
};

export type RpcTransaction = {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
  blockNumber: string;
};

export type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
  transactionHash: string;
};

export type RpcReceipt = {
  transactionHash: string;
  status: string;
  from: string;
  to: string;
  logs: RpcLog[];
};

export type GetLogsFilter = {
  address?: string | string[];
  fromBlock: string;
  toBlock: string;
  topics?: Array<string | null | string[]>;
};

export class RpcClient {
  private blockTimestampCache = new Map<number, number>();
  private tokenCache = new Map<string, TokenMeta>();
  private readonly rpcUrl: string;

  constructor(private readonly chain: ChainConfig, rpcUrl?: string) {
    this.rpcUrl = rpcUrl || chain.rpcUrl;
  }

  async request<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), RPC_REQUEST_TIMEOUT_MS);
      try {
        const headers =
          this.chain.rpcAccessHeadersEnabled === false
            ? { "content-type": "application/json" }
            : serverAccessHeaders({ "content-type": "application/json" });
        const response = await fetch(this.rpcUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new RpcRequestError(
            errorMessage(payload.error || payload.message || `${method} HTTP ${response.status}`),
            response.status,
          );
        }
        if (payload.error) {
          throw new RpcRequestError(errorMessage(payload.error.message || payload.error));
        }
        return payload.result as T;
      } catch (error) {
        const normalizedError =
          error instanceof Error && error.name === "AbortError"
            ? new RpcRequestError(`${method} timed out after ${RPC_REQUEST_TIMEOUT_MS / 1000}s`)
            : error;
        lastError = normalizedError;
        if (attempt >= RPC_MAX_RETRIES || !isRetryableRpcError(normalizedError)) throw normalizedError;
        await sleep(rpcRetryBackoffMs(normalizedError, attempt));
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async batchRequest<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    if (!calls.length) return [];
    if (calls.length === 1) return [await this.request<T>(calls[0].method, calls[0].params)];

    let lastError: unknown;
    for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), RPC_REQUEST_TIMEOUT_MS);
      try {
        const headers =
          this.chain.rpcAccessHeadersEnabled === false
            ? { "content-type": "application/json" }
            : serverAccessHeaders({ "content-type": "application/json" });
        const batch = calls.map((call, index) => ({
          jsonrpc: "2.0",
          id: index + 1,
          method: call.method,
          params: call.params,
        }));
        const response = await fetch(this.rpcUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(batch),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new RpcRequestError(
            errorMessage(payload.error || payload.message || `batch HTTP ${response.status}`),
            response.status,
          );
        }
        if (!Array.isArray(payload)) {
          if (payload.error) throw new RpcRequestError(errorMessage(payload.error.message || payload.error));
          throw new RpcRequestError("RPC batch returned non-array response");
        }

        const byId = new Map<number, unknown>(payload.map((item) => [Number(item?.id), item]));
        return batch.map((request) => {
          const item = byId.get(Number(request.id)) as { result?: T; error?: unknown } | undefined;
          if (!item) throw new RpcRequestError(`RPC batch missing response for id ${request.id}`);
          if (item.error) throw new RpcRequestError(errorMessage((item.error as { message?: unknown })?.message || item.error));
          return item.result as T;
        });
      } catch (error) {
        const normalizedError =
          error instanceof Error && error.name === "AbortError"
            ? new RpcRequestError(`batch timed out after ${RPC_REQUEST_TIMEOUT_MS / 1000}s`)
            : error;
        lastError = normalizedError;
        if (attempt >= RPC_MAX_RETRIES || !isRetryableRpcError(normalizedError)) throw normalizedError;
        await sleep(rpcRetryBackoffMs(normalizedError, attempt));
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async getBlockNumber(): Promise<number> {
    const cached = globalLatestBlockCache.get(this.rpcUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.blockNumber;
    const blockNumber = Number(BigInt(await this.request<string>("eth_blockNumber", [])));
    globalLatestBlockCache.set(this.rpcUrl, { blockNumber, expiresAt: Date.now() + LATEST_BLOCK_CACHE_MS });
    return blockNumber;
  }

  async getBlock(blockNumber: number): Promise<RpcBlock> {
    return this.request<RpcBlock>("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false]);
  }

  async getBlockTimestamp(blockNumber: number): Promise<number> {
    const cached = this.blockTimestampCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const globalCache = globalBlockTimestampCache(this.rpcUrl);
    const globalCached = globalCache.get(blockNumber);
    if (globalCached !== undefined) {
      this.blockTimestampCache.set(blockNumber, globalCached);
      return globalCached;
    }
    const block = await this.getBlock(blockNumber);
    const timestamp = Number(BigInt(block.timestamp));
    this.blockTimestampCache.set(blockNumber, timestamp);
    globalCache.set(blockNumber, timestamp);
    return timestamp;
  }

  async blockByTimestamp(timestampSeconds: number): Promise<number> {
    const timestampCache = globalTimestampBlockCache(this.rpcUrl);
    const cached = timestampCache.get(timestampSeconds);
    if (cached !== undefined) return cached;

    let low = 1;
    let high = await this.getBlockNumber();
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const midTimestamp = await this.getBlockTimestamp(mid);
      if (midTimestamp < timestampSeconds) low = mid + 1;
      else high = mid;
    }
    timestampCache.set(timestampSeconds, low);
    return low;
  }

  async getTransaction(hash: string): Promise<RpcTransaction> {
    const tx = await this.request<RpcTransaction | null>("eth_getTransactionByHash", [hash]);
    if (!tx) throw new Error(`Transaction not found: ${hash}`);
    return tx;
  }

  async getReceipt(hash: string): Promise<RpcReceipt> {
    const receipt = await this.request<RpcReceipt | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt) throw new Error(`Receipt not found: ${hash}`);
    return receipt;
  }

  async getLogs(filter: GetLogsFilter): Promise<RpcLog[]> {
    return this.request<RpcLog[]>("eth_getLogs", [filter]);
  }

  async getLogsBatch(filters: GetLogsFilter[]): Promise<RpcLog[][]> {
    return this.batchRequest<RpcLog[]>(filters.map((filter) => ({ method: "eth_getLogs", params: [filter] })));
  }

  async call(to: string, data: string): Promise<string | null> {
    try {
      return await this.request<string>("eth_call", [{ to, data }, "latest"]);
    } catch {
      return null;
    }
  }

  async tokenMeta(address: string): Promise<TokenMeta> {
    const normalized = normalizeAddress(address);
    const cached = this.tokenCache.get(normalized);
    if (cached) return cached;

    const configuredSymbol = tokenSymbolFromConfig(this.chain, normalized);
    const [symbolRaw, decimalsRaw, nameRaw] = await Promise.all([
      this.call(normalized, "0x95d89b41"),
      this.call(normalized, "0x313ce567"),
      this.call(normalized, "0x06fdde03"),
    ]);

    const token = withTokenGroup(this.chain, {
      address: normalized,
      symbol: decodeString(symbolRaw) || configuredSymbol || "TOKEN",
      name: decodeString(nameRaw) || configuredSymbol,
      decimals: decimalsRaw ? Number(BigInt(decimalsRaw)) : 18,
    });

    this.tokenCache.set(normalized, token);
    return token;
  }
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

class RpcRequestError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = "RpcRequestError";
  }
}

function isRetryableRpcError(error: unknown): boolean {
  const statusCode = error instanceof RpcRequestError ? error.statusCode : undefined;
  if (statusCode && [408, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;
  const message = errorMessage(error).toLowerCase();
  return [
    "rate limit",
    "too many request",
    "timeout",
    "timed out",
    "temporarily unavailable",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "fetch failed",
    "socket hang up",
    "econnreset",
  ].some((needle) => message.includes(needle));
}

function rpcRetryBackoffMs(error: unknown, attempt: number): number {
  const message = errorMessage(error).toLowerCase();
  const isRateLimited =
    (error instanceof RpcRequestError && error.statusCode === 429) ||
    message.includes("rate limit") ||
    message.includes("too many request");
  return (isRateLimited ? 5_000 : RPC_RETRY_BACKOFF_MS) * (attempt + 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function globalBlockTimestampCache(rpcUrl: string): Map<number, number> {
  const existing = globalBlockTimestampCaches.get(rpcUrl);
  if (existing) return existing;
  const created = new Map<number, number>();
  globalBlockTimestampCaches.set(rpcUrl, created);
  return created;
}

function globalTimestampBlockCache(rpcUrl: string): Map<number, number> {
  const existing = globalTimestampBlockCaches.get(rpcUrl);
  if (existing) return existing;
  const created = new Map<number, number>();
  globalTimestampBlockCaches.set(rpcUrl, created);
  return created;
}

function decodeString(hex: string | null): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const data = hex.slice(2);
    if (data.length === 64) {
      const bytes: number[] = [];
      for (let index = 0; index < data.length; index += 2) {
        const byte = Number.parseInt(data.slice(index, index + 2), 16);
        if (byte) bytes.push(byte);
      }
      return Bufferish.from(bytes).replace(/\0+$/, "") || null;
    }

    const offset = Number(BigInt(`0x${data.slice(0, 64)}`)) * 2;
    const length = Number(BigInt(`0x${data.slice(offset, offset + 64)}`)) * 2;
    return Bufferish.fromHex(data.slice(offset + 64, offset + 64 + length)) || null;
  } catch {
    return null;
  }
}

const Bufferish = {
  from(bytes: number[]): string {
    return new TextDecoder().decode(new Uint8Array(bytes));
  },
  fromHex(hex: string): string {
    const bytes: number[] = [];
    for (let index = 0; index < hex.length; index += 2) {
      bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
    }
    return this.from(bytes);
  },
};
