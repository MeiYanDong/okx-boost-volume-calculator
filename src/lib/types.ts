export type ChainId = "bsc" | "xlayer";
export type TokenGroup = "group1" | "group2" | "other";
export type ExplorerApiStyle = "etherscan-v2" | "etherscan-legacy" | "okx-xlayer";
export type TxDiscoverySource = "archive" | "import" | "ankr" | "explorer" | "rpc" | "multi-chain";
export type BoostRuleVersion = "legacy-2026-05-11" | "current-2026-05-12";

export type WalletTransaction = {
  hash: string;
  from?: string;
  to?: string;
  blockNumber?: number;
  timestamp?: number;
};

export type ChainConfig = {
  id: ChainId;
  name: string;
  chainId: number;
  etherscanChainId: number;
  rpcUrl: string;
  rpcAccessHeadersEnabled?: boolean;
  rpcLogChunkSize: number;
  rpcLogAddressFilter?: string[];
  rpcLogFallbackEnabled?: boolean;
  rpcIncrementalFallbackEnabled?: boolean;
  rpcIncrementalFallbackMaxBlocks?: number;
  rpcLogConcurrency?: number;
  rpcLogTopicConcurrency?: number;
  rpcLogRequestDelayMs?: number;
  rpcLogBatchChunkCount?: number;
  rpcTxFilterConcurrency?: number;
  explorerApiUrl: string;
  explorerApiStyle: ExplorerApiStyle;
  explorerTxUrl: string;
  ankrBlockchain?: string;
  chainBonusMultiplier?: number;
  okxRouters: string[];
  nativeToken: TokenMeta;
  stableTokens: string[];
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
  chainId?: ChainId;
  chainName?: string;
  explorerTxUrl?: string;
  ruleVersion?: BoostRuleVersion;
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
  scannedFromBlock?: number;
  scannedToBlock?: number;
  incrementalFromBlock?: number;
  incrementalNewTxCount?: number;
  txDiscoverySource?: TxDiscoverySource;
  chainScans?: Partial<Record<ChainId, ChainScanSummary>>;
};

export type ChainScanSummary = {
  scannedFromBlock?: number;
  scannedToBlock?: number;
  incrementalFromBlock?: number;
  incrementalNewTxCount?: number;
  txDiscoverySource?: TxDiscoverySource;
  txHashes: string[];
};

export type CalculateInput = {
  address: string;
  endDate: string;
  chain: ChainConfig;
  apiKey?: string;
  serviceAccessPassword?: string;
  rpcUrl?: string;
  ankrMultichainRpcUrl?: string;
  walletTransactions?: WalletTransaction[];
  forceRefresh?: boolean;
  incrementalRefresh?: boolean;
  previousResult?: CalculationResult;
  reorgSafetyBlocks?: number;
  boostBonuses: Record<string, number>;
  onProgress?: (message: string) => void;
};
