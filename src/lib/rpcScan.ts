import { normalizeAddress } from "./chains";
import { RpcClient, type RpcTransaction } from "./rpc";
import type { ChainConfig } from "./types";

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const LOG_QUERY_CONCURRENCY = 3;
const TX_FILTER_CONCURRENCY = 6;

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
  const candidateHashes = new Set<string>();

  for (let index = 0; index < chunks.length; index += LOG_QUERY_CONCURRENCY) {
    const batch = chunks.slice(index, index + LOG_QUERY_CONCURRENCY);
    params.onProgress?.(
      `读取公开链上 Transfer 事件 ${Math.min(index + batch.length, chunks.length)}/${chunks.length}...`,
    );
    const results = await Promise.all(
      batch.map((chunk) => queryWalletTransferChunk(params.rpc, chunk.fromBlock, chunk.toBlock, walletTopic)),
    );
    for (const logs of results) {
      for (const log of logs) candidateHashes.add(normalizeAddress(log.transactionHash));
    }
  }

  const candidates = [...candidateHashes];
  const okxHashes: string[] = [];
  const routers = new Set(params.chain.okxRouters.map(normalizeAddress));
  for (let index = 0; index < candidates.length; index += TX_FILTER_CONCURRENCY) {
    const batch = candidates.slice(index, index + TX_FILTER_CONCURRENCY);
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

async function queryWalletTransferChunk(
  rpc: RpcClient,
  fromBlock: number,
  toBlock: number,
  walletTopic: string,
) {
  const [sentLogs, receivedLogs] = await Promise.all([
    rpc.getLogs({
      fromBlock: toBlockHex(fromBlock),
      toBlock: toBlockHex(toBlock),
      topics: [ERC20_TRANSFER_TOPIC, walletTopic],
    }),
    rpc.getLogs({
      fromBlock: toBlockHex(fromBlock),
      toBlock: toBlockHex(toBlock),
      topics: [ERC20_TRANSFER_TOPIC, null, walletTopic],
    }),
  ]);
  return [...sentLogs, ...receivedLogs];
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
