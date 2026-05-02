import { normalizeAddress } from "./chains";
import { serverAccessHeaders } from "./serverAccess";
import type { ChainConfig } from "./types";

const METHOD = "ankr_getTransactionsByAddress";
const PAGE_SIZE = 100;
const MAX_PAGES = 200;

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
  const address = normalizeAddress(params.address);
  const routers = new Set(params.chain.okxRouters);
  const hashes = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    params.onProgress?.(`通过 Ankr Advanced API 读取钱包交易 ${page}/${MAX_PAGES}...`);
    const payload = await fetchAnkrPage({
      rpcUrl: params.rpcUrl,
      address,
      endSeconds: params.endSeconds,
      pageToken,
    });

    const transactions = payload.result?.transactions || [];
    for (const tx of transactions) {
      const timestamp = parseTimestamp(tx.timestamp);
      if (timestamp !== undefined && timestamp < params.startSeconds) {
        return [...hashes];
      }
      if (timestamp !== undefined && timestamp >= params.endSeconds) continue;

      const blockNumber = parseBlockNumber(tx.blockNumber);
      if (blockNumber !== undefined && (blockNumber < params.startBlock || blockNumber > params.endBlock)) continue;

      const hash = tx.hash || "";
      if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) continue;
      if (tx.from && normalizeAddress(tx.from) !== address) continue;
      if (tx.to && !routers.has(normalizeAddress(tx.to))) continue;
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
  address: string;
  endSeconds: number;
  pageToken?: string;
}): Promise<AnkrTransactionsResponse> {
  const url = ankrMethodUrl(params.rpcUrl);
  const requestParams: Record<string, string | number | boolean> = {
    address: params.address,
    blockchain: "bsc",
    descOrder: true,
    includeLogs: false,
    pageSize: PAGE_SIZE,
    toTimestamp: params.endSeconds - 1,
  };
  if (params.pageToken) requestParams.pageToken = params.pageToken;

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
  if (!response.ok || payload.error) {
    const message = payload.error?.message || `Ankr Advanced API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
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
