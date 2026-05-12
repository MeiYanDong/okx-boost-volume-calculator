import { isStableToken, normalizeAddress, ZERO_NATIVE } from "./chains";
import type { BoostRuleVersion, ChainConfig, TokenGroup, TokenMeta } from "./types";

export const BOOST_RULE_CURRENT_EFFECTIVE_TIMESTAMP = Date.UTC(2026, 4, 12) / 1000;
export const BOOST_RULE_CACHE_VERSION = "boost-rules:current-2026-05-12";

export function boostRuleVersionForTimestamp(timestamp: number): BoostRuleVersion {
  return timestamp >= BOOST_RULE_CURRENT_EFFECTIVE_TIMESTAMP ? "current-2026-05-12" : "legacy-2026-05-11";
}

export function baseMultiplierFor(input: TokenMeta, output: TokenMeta, timestamp: number): number {
  const version = boostRuleVersionForTimestamp(timestamp);
  if (version === "current-2026-05-12") return currentBaseMultiplierFor(input.group, output.group);
  return legacyBaseMultiplierFor(input.group, output.group);
}

function legacyBaseMultiplierFor(inputGroup: TokenGroup, outputGroup: TokenGroup): number {
  const pair = new Set<TokenGroup>([inputGroup, outputGroup]);
  if (pair.has("other") && (pair.has("group1") || pair.has("group2"))) return 0.85;
  if (inputGroup === "group2" && outputGroup === "group2") return 0.25;
  if (pair.has("group1") && pair.has("group2")) return 0.25;
  return 0;
}

function currentBaseMultiplierFor(inputGroup: TokenGroup, outputGroup: TokenGroup): number {
  if (inputGroup === "other" && outputGroup === "other") return 0;
  if (inputGroup === "group1" && outputGroup === "group1") return 0.1;
  const pair = new Set<TokenGroup>([inputGroup, outputGroup]);
  if (pair.has("other") && (pair.has("group1") || pair.has("group2"))) return 0.5;
  if (inputGroup === "group2" && outputGroup === "group2") return 0.25;
  if (pair.has("group1") && pair.has("group2")) return 0.25;
  return 0;
}

export function bonusMultiplierFor(
  chain: ChainConfig,
  input: TokenMeta,
  output: TokenMeta,
  boostBonuses: Record<string, number>,
): number {
  const inputBonus = boostBonuses[normalizeAddress(input.address)] || 1;
  const outputBonus = boostBonuses[normalizeAddress(output.address)] || 1;
  const tokenBonus = Math.max(inputBonus, outputBonus, 1);
  return tokenBonus * (chain.chainBonusMultiplier || 1);
}

export function tradeUsdFromStableLeg(params: {
  chain: ChainConfig;
  inputToken: TokenMeta;
  outputToken: TokenMeta;
  inputAmount: number;
  outputAmount: number;
}): { tradeUsd?: number; usdBasis: string } {
  if (isStableToken(params.chain, params.inputToken.address)) {
    return {
      tradeUsd: params.inputAmount,
      usdBasis: `${params.inputToken.symbol} input`,
    };
  }

  if (isStableToken(params.chain, params.outputToken.address)) {
    return {
      tradeUsd: params.outputAmount,
      usdBasis: `${params.outputToken.symbol} net output`,
    };
  }

  return {
    usdBasis: "missing stable leg price",
  };
}

export function mergeBoostBonuses(
  chain: ChainConfig,
  overrides: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [address, bonus] of Object.entries(chain.defaultBoostBonuses)) {
    merged[normalizeAddress(address)] = bonus;
  }
  for (const [address, bonus] of Object.entries(overrides)) {
    merged[normalizeAddress(address)] = bonus;
  }
  return merged;
}

export function isNativeToken(address: string): boolean {
  return normalizeAddress(address) === ZERO_NATIVE;
}
