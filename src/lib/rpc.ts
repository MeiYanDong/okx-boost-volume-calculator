import { normalizeAddress, tokenSymbolFromConfig, withTokenGroup } from "./chains";
import { serverAccessHeaders } from "./serverAccess";
import type { ChainConfig, TokenMeta } from "./types";

const RPC_REQUEST_TIMEOUT_MS = 25_000;
const RPC_MAX_RETRIES = 6;
const RPC_RETRY_BACKOFF_MS = 1_250;

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
        const response = await fetch(this.rpcUrl, {
          method: "POST",
          headers: serverAccessHeaders({ "content-type": "application/json" }),
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
        await sleep(RPC_RETRY_BACKOFF_MS * (attempt + 1));
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async getBlockNumber(): Promise<number> {
    return Number(BigInt(await this.request<string>("eth_blockNumber", [])));
  }

  async getBlock(blockNumber: number): Promise<RpcBlock> {
    return this.request<RpcBlock>("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false]);
  }

  async getBlockTimestamp(blockNumber: number): Promise<number> {
    const cached = this.blockTimestampCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await this.getBlock(blockNumber);
    const timestamp = Number(BigInt(block.timestamp));
    this.blockTimestampCache.set(blockNumber, timestamp);
    return timestamp;
  }

  async blockByTimestamp(timestampSeconds: number): Promise<number> {
    let low = 1;
    let high = await this.getBlockNumber();
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const midTimestamp = await this.getBlockTimestamp(mid);
      if (midTimestamp < timestampSeconds) low = mid + 1;
      else high = mid;
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
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
