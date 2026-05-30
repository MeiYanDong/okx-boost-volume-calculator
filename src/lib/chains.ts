import type { ChainConfig, ChainId, TokenGroup, TokenMeta } from "./types";

export const ZERO_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const BSC_STABLE_TOKENS = [
  "0x55d398326f99059ff775485246999027b3197955",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  "0x4fabb145d64652a948d72533023f6e7a623c7c53",
  "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",
];

const BSC_GROUP1_TOKENS = {
  "0x55d398326f99059ff775485246999027b3197955": "USDT",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "USDC",
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": "WBNB",
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": "BTCB",
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8": "ETH",
  "0x4fabb145d64652a948d72533023f6e7a623c7c53": "BUSD",
  "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409": "FDUSD",
};

const BSC_GROUP2_TOKENS = {
  "0xba2ae424d960c26247dd6c32edc70b295c744c43": "DOGE",
  "0xbf5140a22578168fd562dccf235e5d43a02ce9b1": "UNI",
  "0x4338665cbb7b2485a8855a139b75d5e34ab0db94": "LTC",
  "0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe": "XRP",
};

const XLAYER_USDT0_TOKEN = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const XLAYER_XBETH_TOKEN = "0xafeab3b85b6a56cf5f02317f0f7a23340eb983d7";

export const BSC_CHAIN: ChainConfig = {
  id: "bsc",
  name: "BNB Smart Chain",
  chainId: 56,
  etherscanChainId: 56,
  rpcUrl: "/api/rpc",
  rpcLogChunkSize: 10_000,
  rpcLogAddressFilter: [...new Set([...Object.keys(BSC_GROUP1_TOKENS), ...Object.keys(BSC_GROUP2_TOKENS)])],
  rpcLogFallbackEnabled: true,
  explorerApiUrl: "/api/explorer",
  explorerApiStyle: "etherscan-v2",
  explorerTxUrl: "https://bscscan.com/tx/",
  ankrBlockchain: "bsc",
  okxRouters: [
    "0x62ccef0b4545166f721caa9fee13c1d3767e27dc",
    "0x5cb43bae4f36e2f9f858232b4dce0dbe27bb85e3",
  ],
  nativeToken: {
    address: ZERO_NATIVE,
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    group: "group1",
  },
  stableTokens: BSC_STABLE_TOKENS,
  group1: BSC_GROUP1_TOKENS,
  group2: BSC_GROUP2_TOKENS,
  defaultBoostBonuses: {},
};

export const X_LAYER_CHAIN: ChainConfig = {
  id: "xlayer",
  name: "X Layer",
  chainId: 196,
  etherscanChainId: 196,
  rpcUrl: "/api/rpc?chain=xlayer",
  rpcLogChunkSize: 100,
  rpcLogAddressFilter: [XLAYER_USDT0_TOKEN, XLAYER_XBETH_TOKEN],
  rpcLogFallbackEnabled: false,
  rpcIncrementalFallbackEnabled: true,
  rpcIncrementalFallbackMaxBlocks: 120_000,
  rpcLogConcurrency: 1,
  rpcLogTopicConcurrency: 1,
  rpcLogRequestDelayMs: 800,
  rpcLogBatchChunkCount: 2,
  rpcTxFilterConcurrency: 3,
  explorerApiUrl: "/api/explorer?chain=xlayer",
  explorerApiStyle: "okx-xlayer",
  explorerTxUrl: "https://www.okx.com/web3/explorer/xlayer/tx/",
  ankrBlockchain: "xlayer",
  chainBonusMultiplier: 1.2,
  okxRouters: [
    "0x722db4f285f8bd91ef7af6da397e83f7fa4e80a7",
  ],
  nativeToken: {
    address: ZERO_NATIVE,
    symbol: "OKB",
    name: "OKB",
    decimals: 18,
    group: "other",
  },
  stableTokens: [
    XLAYER_USDT0_TOKEN,
  ],
  group1: {
    [XLAYER_USDT0_TOKEN]: "USDt0",
  },
  group2: {},
  defaultBoostBonuses: {},
};

export const CHAINS = [BSC_CHAIN, X_LAYER_CHAIN];

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function isStableToken(chain: ChainConfig, address: string): boolean {
  return chain.stableTokens.map(normalizeAddress).includes(normalizeAddress(address));
}

export function tokenGroup(chain: ChainConfig, address: string): TokenGroup {
  const normalized = normalizeAddress(address);
  if (normalized === ZERO_NATIVE) return "group1";
  if (chain.group1[normalized]) return "group1";
  if (chain.group2[normalized]) return "group2";
  return "other";
}

export function tokenSymbolFromConfig(chain: ChainConfig, address: string): string | undefined {
  const normalized = normalizeAddress(address);
  return chain.group1[normalized] || chain.group2[normalized];
}

export function withTokenGroup(chain: ChainConfig, token: Omit<TokenMeta, "group">): TokenMeta {
  return {
    ...token,
    address: normalizeAddress(token.address),
    group: tokenGroup(chain, token.address),
  };
}

export function chainById(chainId: ChainId | undefined): ChainConfig {
  return CHAINS.find((chain) => chain.id === chainId) || BSC_CHAIN;
}
