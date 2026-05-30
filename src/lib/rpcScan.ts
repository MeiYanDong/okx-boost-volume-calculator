import { normalizeAddress } from "./chains";
import { RpcClient, type GetLogsFilter, type RpcTransaction } from "./rpc";
import type { ChainConfig } from "./types";

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEFAULT_LOG_QUERY_CONCURRENCY = 3;
const DEFAULT_LOG_TOPIC_CONCURRENCY = 2;
const DEFAULT_TX_FILTER_CONCURRENCY = 6;

type FetchWalletOkxHashesParams = {
  chain: ChainConfig;
  rpc: RpcClient;
  address: string;
  startBlock: number;
  endBlock: number;
  onProgress?: (message: string) => void;
};

export async function fetchWalletOkxHashesByRpc(params: FetchWalletOkxHashesParams): Promise<string[]> {
  const wallet = normalizeAddress(params.address);
  const walletTopic = addressToTopic(wallet);
  const chunks = buildBlockChunks(params.startBlock, params.endBlock, params.chain.rpcLogChunkSize);
  const logConcurrency = positiveInteger(params.chain.rpcLogConcurrency, DEFAULT_LOG_QUERY_CONCURRENCY);
  const txFilterConcurrency = positiveInteger(params.chain.rpcTxFilterConcurrency, DEFAULT_TX_FILTER_CONCURRENCY);
  const requestDelayMs = Math.max(0, params.chain.rpcLogRequestDelayMs || 0);
  const batchChunkCount = Math.max(0, params.chain.rpcLogBatchChunkCount || 0);
  const candidateHashes = new Set<string>();

  if (batchChunkCount > 1) {
    for (let index = 0; index < chunks.length; index += batchChunkCount) {
      const batch = chunks.slice(index, index + batchChunkCount);
      params.onProgress?.(
        `读取公开链上 Transfer 事件 ${Math.min(index + batch.length, chunks.length)}/${chunks.length}...`,
      );
      const logs = await queryWalletTransferChunkBatch({
        chain: params.chain,
        rpc: params.rpc,
        chunks: batch,
        walletTopic,
      });
      for (const log of logs) candidateHashes.add(normalizeAddress(log.transactionHash));
      if (requestDelayMs > 0 && index + batch.length < chunks.length) await sleep(requestDelayMs);
    }
  } else {
    for (let index = 0; index < chunks.length; index += logConcurrency) {
      const batch = chunks.slice(index, index + logConcurrency);
      params.onProgress?.(
        `读取公开链上 Transfer 事件 ${Math.min(index + batch.length, chunks.length)}/${chunks.length}...`,
      );
      const results = await Promise.all(
        batch.map((chunk) =>
          queryWalletTransferChunk({
            chain: params.chain,
            rpc: params.rpc,
            fromBlock: chunk.fromBlock,
            toBlock: chunk.toBlock,
            walletTopic,
          }),
        ),
      );
      for (const logs of results) {
        for (const log of logs) candidateHashes.add(normalizeAddress(log.transactionHash));
      }
      if (requestDelayMs > 0 && index + batch.length < chunks.length) await sleep(requestDelayMs);
    }
  }

  const candidates = [...candidateHashes];
  const okxHashes: string[] = [];
  const routers = new Set(params.chain.okxRouters.map(normalizeAddress));
  for (let index = 0; index < candidates.length; index += txFilterConcurrency) {
    const batch = candidates.slice(index, index + txFilterConcurrency);
    params.onProgress?.(
      `筛选 OKX Router 交易 ${Math.min(index + batch.length, candidates.length)}/${candidates.length}...`,
    );
    const transactions = await Promise.all(batch.map((hash) => params.rpc.getTransaction(hash)));
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      if (isUserOkxRouterTx(transactions[batchIndex], wallet, routers)) okxHashes.push(batch[batchIndex]);
    }
  }

  return okxHashes;
}

async function queryWalletTransferChunkBatch(params: {
  chain: ChainConfig;
  rpc: RpcClient;
  chunks: Array<{ fromBlock: number; toBlock: number }>;
  walletTopic: string;
}) {
  const filters = params.chunks.flatMap((chunk) =>
    walletTransferFilters(params.chain, chunk.fromBlock, chunk.toBlock, params.walletTopic),
  );
  const results = await params.rpc.getLogsBatch(filters);
  return results.flat();
}

async function queryWalletTransferChunk(params: {
  chain: ChainConfig;
  rpc: RpcClient;
  fromBlock: number;
  toBlock: number;
  walletTopic: string;
}) {
  const topicConcurrency = positiveInteger(params.chain.rpcLogTopicConcurrency, DEFAULT_LOG_TOPIC_CONCURRENCY);
  const requestDelayMs = Math.max(0, params.chain.rpcLogRequestDelayMs || 0);
  const [sentFilter, receivedFilter] = walletTransferFilters(
    params.chain,
    params.fromBlock,
    params.toBlock,
    params.walletTopic,
  );

  if (topicConcurrency <= 1) {
    const sentLogs = await params.rpc.getLogs(sentFilter);
    if (requestDelayMs > 0) await sleep(requestDelayMs);
    const receivedLogs = await params.rpc.getLogs(receivedFilter);
    return [...sentLogs, ...receivedLogs];
  }

  const [sentLogs, receivedLogs] = await Promise.all([
    params.rpc.getLogs(sentFilter),
    params.rpc.getLogs(receivedFilter),
  ]);
  return [...sentLogs, ...receivedLogs];
}

function walletTransferFilters(
  chain: ChainConfig,
  fromBlock: number,
  toBlock: number,
  walletTopic: string,
): [GetLogsFilter, GetLogsFilter] {
  const sentFilter = {
    ...rpcLogAddressFilter(chain),
    fromBlock: toBlockHex(fromBlock),
    toBlock: toBlockHex(toBlock),
    topics: [ERC20_TRANSFER_TOPIC, walletTopic],
  };
  const receivedFilter = {
    ...rpcLogAddressFilter(chain),
    fromBlock: toBlockHex(fromBlock),
    toBlock: toBlockHex(toBlock),
    topics: [ERC20_TRANSFER_TOPIC, null, walletTopic],
  };
  return [sentFilter, receivedFilter];
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function rpcLogAddressFilter(chain: ChainConfig): { address?: string | string[] } {
  const addresses = [...new Set((chain.rpcLogAddressFilter || []).map(normalizeAddress))];
  if (!addresses.length) return {};
  return { address: addresses.length === 1 ? addresses[0] : addresses };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isUserOkxRouterTx(tx: RpcTransaction, wallet: string, routers: Set<string>): boolean {
  return normalizeAddress(tx.from) === wallet && routers.has(normalizeAddress(tx.to || ""));
}

function buildBlockChunks(startBlock: number, endBlock: number, chunkSize: number) {
  const chunks: Array<{ fromBlock: number; toBlock: number }> = [];
  const safeChunkSize = Math.max(1, chunkSize);
  for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += safeChunkSize) {
    chunks.push({
      fromBlock,
      toBlock: Math.min(endBlock, fromBlock + safeChunkSize - 1),
    });
  }
  return chunks;
}

function addressToTopic(address: string): string {
  return `0x${normalizeAddress(address).slice(2).padStart(64, "0")}`;
}

function toBlockHex(blockNumber: number): string {
  return `0x${blockNumber.toString(16)}`;
}
