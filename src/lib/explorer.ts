import type { ChainConfig } from "./types";
import { normalizeAddress } from "./chains";
import { serverAccessHeaders } from "./serverAccess";

const ETHERSCAN_PAGE_SIZE = 10_000;
const OKX_XLAYER_PAGE_SIZE = 50;
const ETHERSCAN_MAX_PAGES = 20;
const OKX_XLAYER_MAX_PAGES = 100;

type ExplorerTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  isError?: string;
  txreceipt_status?: string;
};

type ExplorerResponse = {
  status: string;
  message: string;
  result: ExplorerTx[] | string;
};

type OkxXLayerResponse = {
  code?: string;
  msg?: string;
  data?: unknown;
};

type OkxXLayerTx = {
  txId?: string;
  txid?: string;
  hash?: string;
  txHash?: string;
  height?: string;
  blockHeight?: string;
  blockNumber?: string;
  transactionTime?: string;
  timestamp?: string;
  time?: string;
  from?: string;
  fromAddress?: string;
  to?: string;
  toAddress?: string;
  state?: string;
  status?: string;
  txStatus?: string;
};

export async function fetchAddressOkxHashes(params: {
  chain: ChainConfig;
  address: string;
  startBlock: number;
  endBlock: number;
  apiKey: string;
  serviceAccessPassword?: string;
}): Promise<string[]> {
  const transactions: ExplorerTx[] = [];
  const pageSize = explorerPageSize(params.chain);
  const maxPages = explorerMaxPages(params.chain);
  for (let page = 1; page <= maxPages; page += 1) {
    const pageTransactions = await fetchAddressTxPage({
      ...params,
      page,
    });
    transactions.push(...pageTransactions);

    if (pageTransactions.length < pageSize) break;
    if (page === maxPages) {
      throw new Error(`Explorer API returned more than ${maxPages * pageSize} wallet transactions in this window`);
    }
  }

  const address = normalizeAddress(params.address);
  const routers = new Set(params.chain.okxRouters);
  return [
    ...new Set(
      transactions
        .filter((tx) => normalizeAddress(tx.from) === address)
        .filter((tx) => routers.has(normalizeAddress(tx.to || "")))
        .filter((tx) => tx.isError !== "1" && tx.txreceipt_status !== "0")
        .map((tx) => tx.hash),
    ),
  ];
}

async function fetchAddressTxPage(params: {
  chain: ChainConfig;
  address: string;
  startBlock: number;
  endBlock: number;
  apiKey: string;
  serviceAccessPassword?: string;
  page: number;
}): Promise<ExplorerTx[]> {
  const url = new URL(params.chain.explorerApiUrl, globalThis.location?.origin || "http://localhost");
  const pageSize = explorerPageSize(params.chain);
  if (params.chain.explorerApiStyle === "etherscan-v2") {
    url.searchParams.set("chainid", String(params.chain.etherscanChainId));
  }
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", params.address);
  url.searchParams.set("startblock", String(params.startBlock));
  url.searchParams.set("endblock", String(params.endBlock));
  url.searchParams.set("sort", "asc");
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("offset", String(pageSize));
  url.searchParams.set("apikey", params.apiKey);

  const headers = params.serviceAccessPassword
    ? serverAccessHeaders({ "x-okx-boost-access": params.serviceAccessPassword })
    : serverAccessHeaders();
  const response = await fetch(url, { headers });
  const payload = (await response.json().catch(() => ({}))) as (ExplorerResponse & OkxXLayerResponse & { error?: string });
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Explorer API HTTP ${response.status}`);
  }
  if (params.chain.explorerApiStyle === "okx-xlayer") {
    return okxXLayerTransactions(payload);
  }
  if (!Array.isArray(payload.result)) {
    if (/no transactions found/i.test(payload.result)) return [];
    throw new Error(payload.result || payload.message || "Explorer API returned no transactions");
  }
  return payload.result;
}

function explorerPageSize(chain: ChainConfig) {
  return chain.explorerApiStyle === "okx-xlayer" ? OKX_XLAYER_PAGE_SIZE : ETHERSCAN_PAGE_SIZE;
}

function explorerMaxPages(chain: ChainConfig) {
  return chain.explorerApiStyle === "okx-xlayer" ? OKX_XLAYER_MAX_PAGES : ETHERSCAN_MAX_PAGES;
}

function okxXLayerTransactions(payload: OkxXLayerResponse): ExplorerTx[] {
  if (payload.code && payload.code !== "0") {
    throw new Error(payload.msg || `OKX X Layer Explorer returned code ${payload.code}`);
  }

  return extractOkxXLayerItems(payload.data).map((tx) => ({
    blockNumber: tx.height || tx.blockHeight || tx.blockNumber || "0",
    timeStamp: toSecondsTimestamp(tx.transactionTime || tx.timestamp || tx.time || "0"),
    hash: tx.txId || tx.txid || tx.hash || tx.txHash || "",
    from: tx.from || tx.fromAddress || "",
    to: tx.to || tx.toAddress || "",
    isError: okxXLayerIsFailed(tx) ? "1" : "0",
    txreceipt_status: okxXLayerIsFailed(tx) ? "0" : "1",
  })).filter((tx) => /^0x[a-fA-F0-9]{64}$/.test(tx.hash));
}

function extractOkxXLayerItems(data: unknown): OkxXLayerTx[] {
  if (!Array.isArray(data)) return [];
  const items: OkxXLayerTx[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const directLists = [item.transactionList, item.transactionLists, item.blockList];
    for (const list of directLists) {
      if (Array.isArray(list)) items.push(...list.filter(isOkxXLayerTx));
    }
    if (isOkxXLayerTx(item)) items.push(item);
  }
  return items;
}

function isOkxXLayerTx(value: unknown): value is OkxXLayerTx {
  return isRecord(value) && Boolean(value.txId || value.txid || value.hash || value.txHash);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toSecondsTimestamp(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0";
  return String(numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric));
}

function okxXLayerIsFailed(tx: OkxXLayerTx) {
  const status = String(tx.state || tx.status || tx.txStatus || "").toLowerCase();
  if (!status) return false;
  return !["success", "done", "1"].includes(status);
}
