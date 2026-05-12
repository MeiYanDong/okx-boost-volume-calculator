import { baseMultiplierFor, bonusMultiplierFor, boostRuleVersionForTimestamp, tradeUsdFromStableLeg } from "./boostRules";
import { formatUnitsNumber, toUtcDate } from "./format";
import { normalizeAddress, ZERO_NATIVE } from "./chains";
import { RpcClient, type RpcLog, type RpcReceipt, type RpcTransaction } from "./rpc";
import type { ChainConfig, ParsedSwap, TokenMeta, TransferEvent } from "./types";

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function parseOkxSwap(params: {
  chain: ChainConfig;
  rpc: RpcClient;
  hash: string;
  userAddress: string;
  boostBonuses: Record<string, number>;
}): Promise<ParsedSwap> {
  const user = normalizeAddress(params.userAddress);
  const [tx, receipt] = await Promise.all([
    params.rpc.getTransaction(params.hash),
    params.rpc.getReceipt(params.hash),
  ]);

  const router = normalizeAddress(tx.to || receipt.to || "");
  const isOkxRouter = params.chain.okxRouters.includes(router);
  if (!isOkxRouter) {
    throw new Error(`${params.hash} is not an OKX router transaction on ${params.chain.name}`);
  }
  if (normalizeAddress(tx.from) !== user) {
    throw new Error(`${params.hash} was not sent by ${params.userAddress}`);
  }

  const timestamp = await params.rpc.getBlockTimestamp(Number(BigInt(tx.blockNumber)));
  const transfers = parseTransfers(receipt);
  const tokenMeta = await loadTokenMetadata(params.rpc, transfers);
  const input = await inferInputLeg(params.chain, params.rpc, tx, transfers, tokenMeta, user);
  const output = await inferOutputLeg(params.chain, tx, transfers, tokenMeta, user);

  if (!input || !output) {
    return fallbackSwap(params.chain, tx, timestamp, router, params.userAddress, "Unable to infer swap legs");
  }

  const inputAmount = formatUnitsNumber(input.value, input.token.decimals);
  const outputAmount = formatUnitsNumber(output.value, output.token.decimals);
  const feeAmount = inferFeeAmount(transfers, output.token, router, user);
  const { tradeUsd, usdBasis } = tradeUsdFromStableLeg({
    chain: params.chain,
    inputToken: input.token,
    outputToken: output.token,
    inputAmount,
    outputAmount,
  });
  const ruleVersion = boostRuleVersionForTimestamp(timestamp);
  const baseMultiplier = baseMultiplierFor(input.token, output.token, timestamp);
  const bonusMultiplier = bonusMultiplierFor(params.chain, input.token, output.token, params.boostBonuses);
  const boostVolume = tradeUsd === undefined ? 0 : tradeUsd * baseMultiplier * bonusMultiplier;
  const status = tradeUsd === undefined ? "partial" : baseMultiplier === 0 ? "excluded" : "counted";

  return {
    hash: params.hash,
    chainId: params.chain.id,
    chainName: params.chain.name,
    explorerTxUrl: params.chain.explorerTxUrl,
    ruleVersion,
    timestamp,
    utcDate: toUtcDate(timestamp),
    sender: normalizeAddress(tx.from),
    router,
    inputToken: input.token,
    outputToken: output.token,
    inputAmount,
    outputAmount,
    feeAmount,
    tradeUsd,
    usdBasis,
    baseMultiplier,
    bonusMultiplier,
    boostVolume,
    status,
    reason: status === "excluded" ? "Pair is excluded by current Boost token-group rules" : undefined,
  };
}

function parseTransfers(receipt: RpcReceipt): TransferEvent[] {
  return receipt.logs
    .filter((log) => normalizeAddress(log.topics[0] || "") === ERC20_TRANSFER_TOPIC)
    .filter((log) => log.topics.length >= 3)
    .map((log) => ({
      token: normalizeAddress(log.address),
      from: topicToAddress(log.topics[1]),
      to: topicToAddress(log.topics[2]),
      value: BigInt(log.data),
      logIndex: Number(BigInt(log.logIndex)),
    }))
    .sort((a, b) => a.logIndex - b.logIndex);
}

async function loadTokenMetadata(
  rpc: RpcClient,
  transfers: TransferEvent[],
): Promise<Map<string, TokenMeta>> {
  const addresses = [...new Set(transfers.map((transfer) => transfer.token))];
  const entries = await Promise.all(addresses.map(async (address) => [address, await rpc.tokenMeta(address)] as const));
  return new Map(entries);
}

async function inferInputLeg(
  chain: ChainConfig,
  rpc: RpcClient,
  tx: RpcTransaction,
  transfers: TransferEvent[],
  tokenMeta: Map<string, TokenMeta>,
  user: string,
): Promise<{ token: TokenMeta; value: bigint } | null> {
  const nativeValue = BigInt(tx.value);
  if (nativeValue > 0n) {
    return { token: chain.nativeToken, value: nativeValue };
  }

  const outgoing = transfers.filter((event) => event.from === user && event.to !== user && event.value > 0n);
  if (!outgoing.length) return null;

  const outputToken = [...transfers].reverse().find((event) => event.to === user && event.from !== user)?.token;
  const transfer = await selectPrimaryInputTransfer(outgoing, transfers, tokenMeta, rpc, outputToken);
  const token = tokenMeta.get(transfer.token) || (await rpc.tokenMeta(transfer.token));
  const totalValue = outgoing
    .filter((event) => event.token === transfer.token)
    .reduce((sum, event) => sum + event.value, 0n);
  return { token, value: totalValue };
}

async function selectPrimaryInputTransfer(
  outgoing: TransferEvent[],
  transfers: TransferEvent[],
  tokenMeta: Map<string, TokenMeta>,
  rpc: RpcClient,
  outputToken: string | undefined,
): Promise<TransferEvent> {
  const scored = await Promise.all(
    outgoing.map(async (event) => {
      const token = tokenMeta.get(event.token) || (await rpc.tokenMeta(event.token));
      const amount = formatUnitsNumber(event.value, token.decimals);
      const forwardsIntoRoute = transfers.some(
        (candidate) => candidate.logIndex > event.logIndex && candidate.from === event.to,
      );
      return {
        event,
        amount,
        routeScore: forwardsIntoRoute ? 1 : 0,
        tokenScore: outputToken && event.token !== outputToken ? 1 : 0,
      };
    }),
  );

  scored.sort((a, b) => {
    if (b.routeScore !== a.routeScore) return b.routeScore - a.routeScore;
    if (b.tokenScore !== a.tokenScore) return b.tokenScore - a.tokenScore;
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.event.logIndex - b.event.logIndex;
  });

  return scored[0].event;
}

async function inferOutputLeg(
  chain: ChainConfig,
  tx: RpcTransaction,
  transfers: TransferEvent[],
  tokenMeta: Map<string, TokenMeta>,
  user: string,
): Promise<{ token: TokenMeta; value: bigint } | null> {
  const transfer = [...transfers].reverse().find((event) => event.to === user && event.from !== user);
  if (transfer) return { token: tokenMeta.get(transfer.token)!, value: transfer.value };

  if (BigInt(tx.value) === 0n) {
    const nativeOut = inferNativeOutputPlaceholder(chain);
    if (nativeOut) return nativeOut;
  }
  return null;
}

function inferFeeAmount(
  transfers: TransferEvent[],
  outputToken: TokenMeta,
  router: string,
  user: string,
): number | undefined {
  const feeTransfers = transfers.filter(
    (event) =>
      event.token === normalizeAddress(outputToken.address) &&
      event.from === router &&
      event.to !== user &&
      event.value > 0n,
  );
  if (!feeTransfers.length) return undefined;
  return feeTransfers.reduce((sum, event) => sum + formatUnitsNumber(event.value, outputToken.decimals), 0);
}

function fallbackSwap(
  chain: ChainConfig,
  tx: RpcTransaction,
  timestamp: number,
  router: string,
  userAddress: string,
  reason: string,
): ParsedSwap {
  return {
    hash: tx.hash,
    chainId: chain.id,
    chainName: chain.name,
    explorerTxUrl: chain.explorerTxUrl,
    ruleVersion: boostRuleVersionForTimestamp(timestamp),
    timestamp,
    utcDate: toUtcDate(timestamp),
    sender: normalizeAddress(userAddress),
    router,
    inputToken: chain.nativeToken,
    outputToken: chain.nativeToken,
    inputAmount: 0,
    outputAmount: 0,
    usdBasis: "unknown",
    baseMultiplier: 0,
    bonusMultiplier: 1,
    boostVolume: 0,
    status: "partial",
    reason,
  };
}

function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function inferNativeOutputPlaceholder(chain: ChainConfig): { token: TokenMeta; value: bigint } | null {
  if (chain.nativeToken.address === ZERO_NATIVE) return null;
  return { token: chain.nativeToken, value: 0n };
}

export function extractHashes(raw: string): string[] {
  return [...new Set(raw.match(/0x[a-fA-F0-9]{64}/g) || [])];
}

export function isOkxRouterTx(chain: ChainConfig, tx: { from: string; to: string }) {
  return chain.okxRouters.includes(normalizeAddress(tx.to)) && Boolean(tx.from);
}

export function receiptContainsUser(receipt: RpcReceipt, userAddress: string): boolean {
  const user = normalizeAddress(userAddress);
  return receipt.logs.some((log: RpcLog) => {
    if (normalizeAddress(log.topics[0] || "") !== ERC20_TRANSFER_TOPIC || log.topics.length < 3) return false;
    return topicToAddress(log.topics[1]) === user || topicToAddress(log.topics[2]) === user;
  });
}
