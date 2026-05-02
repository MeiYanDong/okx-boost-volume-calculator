import type { ChainConfig } from "./types";
import { normalizeAddress } from "./chains";
import { serverAccessHeaders } from "./serverAccess";

const PAGE_SIZE = 10_000;
const MAX_PAGES = 20;

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

export async function fetchAddressOkxHashes(params: {
  chain: ChainConfig;
  address: string;
  startBlock: number;
  endBlock: number;
  apiKey: string;
}): Promise<string[]> {
  const transactions: ExplorerTx[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageTransactions = await fetchAddressTxPage({
      ...params,
      page,
    });
    transactions.push(...pageTransactions);

    if (pageTransactions.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) {
      throw new Error(`Explorer API returned more than ${MAX_PAGES * PAGE_SIZE} wallet transactions in this window`);
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
  page: number;
}): Promise<ExplorerTx[]> {
  const url = new URL(params.chain.explorerApiUrl, globalThis.location?.origin || "http://localhost");
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
  url.searchParams.set("offset", String(PAGE_SIZE));
  url.searchParams.set("apikey", params.apiKey);

  const response = await fetch(url, { headers: serverAccessHeaders() });
  const payload = (await response.json().catch(() => ({}))) as ExplorerResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Explorer API HTTP ${response.status}`);
  }
  if (!Array.isArray(payload.result)) {
    if (/no transactions found/i.test(payload.result)) return [];
    throw new Error(payload.result || payload.message || "Explorer API returned no transactions");
  }
  return payload.result;
}
