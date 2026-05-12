import { normalizeAddress } from "./chains";
import { BOOST_RULE_CACHE_VERSION } from "./boostRules";
import type { ChainConfig, ParsedSwap } from "./types";

const CACHE_PREFIX = "okx-boost:v5";
const TX_HASHES_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PARSED_SWAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CacheRecord<T> = {
  expiresAt: number;
  value: T;
};

export function txHashesCacheKey(params: {
  chain: ChainConfig;
  address: string;
  startBlock: number;
  endBlock: number;
}): string {
  return [
    CACHE_PREFIX,
    "tx-hashes",
    params.chain.id,
    normalizeAddress(params.address),
    params.startBlock,
    params.endBlock,
  ].join(":");
}

export function parsedSwapCacheKey(params: {
  chain: ChainConfig;
  address: string;
  hash: string;
  boostBonuses: Record<string, number>;
}): string {
  return [
    CACHE_PREFIX,
    "parsed-swap",
    params.chain.id,
    normalizeAddress(params.address),
    normalizeAddress(params.hash),
    BOOST_RULE_CACHE_VERSION,
    boostBonusSignature(params.boostBonuses),
  ].join(":");
}

export function readTxHashesCache(key: string): string[] | null {
  return readCache<string[]>(key);
}

export function writeTxHashesCache(key: string, hashes: string[]) {
  writeCache(key, hashes, TX_HASHES_TTL_MS);
}

export function readParsedSwapCache(key: string): ParsedSwap | null {
  return readCache<ParsedSwap>(key);
}

export function writeParsedSwapCache(key: string, swap: ParsedSwap) {
  writeCache(key, swap, PARSED_SWAP_TTL_MS);
}

function boostBonusSignature(boostBonuses: Record<string, number>): string {
  return Object.entries(boostBonuses)
    .map(([address, multiplier]) => `${normalizeAddress(address)}=${multiplier}`)
    .sort()
    .join(",");
}

function readCache<T>(key: string): T | null {
  const storage = safeStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as CacheRecord<T>;
    if (!record || record.expiresAt < Date.now()) {
      storage.removeItem(key);
      return null;
    }
    return record.value;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function writeCache<T>(key: string, value: T, ttlMs: number) {
  const storage = safeStorage();
  if (!storage) return;

  try {
    const record: CacheRecord<T> = {
      expiresAt: Date.now() + ttlMs,
      value,
    };
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Cache is an optimization only. Ignore quota or privacy-mode failures.
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
