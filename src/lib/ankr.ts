import { normalizeAddress } from "./chains";
import { serverAccessHeaders } from "./serverAccess";
import type { ChainConfig } from "./types";

const METHOD = "ankr_getTransactionsByAddress";
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const MAX_RATE_LIMIT_RETRIES = 8;
const RATE_LIMIT_BACKOFF_MS = 2_000;

type AnkrTransaction = {
  blockNumber?: string;
  from?: string;
  hash?: string;
  status?: string;
  timestamp?: string;
  to?: string;
};

type AnkrTransactionsResponse = {
  result?: {
    nextPageToken?: string;
    transactions?: AnkrTransaction[];
  };
  error?: {
    code?: number;
    message?: string;
  };
};

export async function fetchAnkrAddressOkxHashes(params: {
  chain: ChainConfig;
  rpcUrl: string;
  address: string;
  startBlock: number;
  endBlock: number;
  startSeconds: number;
  endSeconds: number;
  onProgress?: (message: string) => void;
}): Promise<string[]> {
  if (!params.chain.ankrBlockchain) {
    throw new Error(`Ankr Advanced API is not configured for ${params.chain.name}`);
  }
  const address = normalizeAddress(params.address);
  const routers = new Set(params.chain.okxRouters);
  const hashes = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    params.onProgress?.(`通过 Ankr Advanced API 读取钱包交易 ${page}/${MAX_PAGES}...`);
    const payload = await fetchAnkrPage({
      rpcUrl: params.rpcUrl,
      blockchain: params.chain.ankrBlockchain,
      address,
      endSeconds: params.endSeconds,
      pageToken,
    });

    const transactions = payload.result?.transactions || [];
    for (const tx of transactions) {
      const blockNumber = parseBlockNumber(tx.blockNumber);
      if (blockNumber !== undefined && blockNumber < params.startBlock) {
        return [...hashes];
      }
      if (blockNumber !== undefined && blockNumber > params.endBlock) continue;

      const timestamp = parseTimestamp(tx.timestamp);
      if (timestamp !== undefined && timestamp < params.startSeconds) {
        return [...hashes];
      }
      if (timestamp !== undefined && timestamp >= params.endSeconds) continue;

      const hash = tx.hash || "";
      if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) continue;
      if (!tx.from || normalizeAddress(tx.from) !== address) continue;
      if (!tx.to || !routers.has(normalizeAddress(tx.to))) continue;
      if (tx.status === "0" || tx.status === "0x0" || tx.status === "failed") continue;
      hashes.add(hash);
    }

    pageToken = payload.result?.nextPageToken;
    if (!pageToken || transactions.length === 0) break;
  }

  return [...hashes];
}

async function fetchAnkrPage(params: {
  rpcUrl: string;
  blockchain: string;
  address: string;
  endSeconds: number;
  pageToken?: string;
}): Promise<AnkrTransactionsResponse> {
  const url = ankrMethodUrl(params.rpcUrl);
  const requestParams: Record<string, string | number | boolean> = {
    address: params.address,
    blockchain: params.blockchain,
    descOrder: true,
    includeLogs: false,
    pageSize: PAGE_SIZE,
    toTimestamp: params.endSeconds - 1,
  };
  if (params.pageToken) requestParams.pageToken = params.pageToken;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: serverAccessHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: METHOD,
        params: requestParams,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as AnkrTransactionsResponse;
    if (response.ok && !payload.error) return payload;

    const message = payload.error?.message || `Ankr Advanced API HTTP ${response.status}`;
    if (!isRateLimitError(response.status, message) || attempt === MAX_RATE_LIMIT_RETRIES) {
      throw new Error(message);
    }
    await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
  }

  throw new Error("Ankr Advanced API rate limit retry exhausted");
}

function ankrMethodUrl(rawUrl: string): string {
  const url = new URL(rawUrl, globalThis.location?.origin || "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname.includes("ankr.com") && parts[0] !== "multichain" && parts[1]) {
    url.pathname = `/multichain/${parts[1]}`;
  }
  url.search = "";
  return url.toString();
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : parsed;
}

function parseBlockNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = value.startsWith("0x") ? Number(BigInt(value)) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRateLimitError(status: number, message: string): boolean {
  return status === 429 || /rate limit|too many requests/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
