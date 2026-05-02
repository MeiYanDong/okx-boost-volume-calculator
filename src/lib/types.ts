export type TokenGroup = "group1" | "group2" | "other";
export type ExplorerApiStyle = "etherscan-v2" | "etherscan-legacy";

export type WalletTransaction = {
  hash: string;
  from?: string;
  to?: string;
  blockNumber?: number;
  timestamp?: number;
};

export type ChainConfig = {
  id: "bsc";
  name: string;
  chainId: number;
  etherscanChainId: number;
  rpcUrl: string;
  rpcLogChunkSize: number;
  explorerApiUrl: string;
  explorerApiStyle: ExplorerApiStyle;
  explorerTxUrl: string;
  okxRouters: string[];
  nativeToken: TokenMeta;
  group1: Record<string, string>;
  group2: Record<string, string>;
  defaultBoostBonuses: Record<string, number>;
};

export type TokenMeta = {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
  group: TokenGroup;
};

export type TransferEvent = {
  token: string;
  from: string;
  to: string;
  value: bigint;
  logIndex: number;
};

export type ParsedSwap = {
  hash: string;
  timestamp: number;
  utcDate: string;
  sender: string;
  router: string;
  inputToken: TokenMeta;
  outputToken: TokenMeta;
  inputAmount: number;
  outputAmount: number;
  feeAmount?: number;
  tradeUsd?: number;
  usdBasis: string;
  baseMultiplier: number;
  bonusMultiplier: number;
  boostVolume: number;
  status: "counted" | "excluded" | "partial";
  reason?: string;
};

export type DailyBoostRow = {
  date: string;
  txCount: number;
  boostVolume: number;
  tradeUsd: number;
};

export type CalculationResult = {
  windowStart: string;
  windowEnd: string;
  averageBoostVolume: number;
  totalBoostVolume: number;
  totalTradeUsd: number;
  dailyRows: DailyBoostRow[];
  swaps: ParsedSwap[];
  warnings: string[];
  txHashes: string[];
};

export type CalculateInput = {
  address: string;
  endDate: string;
  chain: ChainConfig;
  apiKey?: string;
  rpcUrl?: string;
  ankrMultichainRpcUrl?: string;
  walletTransactions?: WalletTransaction[];
  boostBonuses: Record<string, number>;
  onProgress?: (message: string) => void;
};
