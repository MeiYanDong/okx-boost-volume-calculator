import { isStableToken, normalizeAddress, ZERO_NATIVE } from "./chains";
import type { ChainConfig, TokenGroup, TokenMeta } from "./types";

export function baseMultiplierFor(input: TokenMeta, output: TokenMeta): number {
  const pair = new Set<TokenGroup>([input.group, output.group]);
  if (pair.has("other") && (pair.has("group1") || pair.has("group2"))) return 0.85;
  if (input.group === "group2" && output.group === "group2") return 0.25;
  if (pair.has("group1") && pair.has("group2")) return 0.25;
  return 0;
}

export function bonusMultiplierFor(
  input: TokenMeta,
  output: TokenMeta,
  boostBonuses: Record<string, number>,
): number {
  const inputBonus = boostBonuses[normalizeAddress(input.address)] || 1;
  const outputBonus = boostBonuses[normalizeAddress(output.address)] || 1;
  return Math.max(inputBonus, outputBonus, 1);
}

export function tradeUsdFromStableLeg(params: {
  inputToken: TokenMeta;
  outputToken: TokenMeta;
  inputAmount: number;
  outputAmount: number;
}): { tradeUsd?: number; usdBasis: string } {
  if (isStableToken(params.inputToken.address)) {
    return {
      tradeUsd: params.inputAmount,
      usdBasis: `${params.inputToken.symbol} input`,
    };
  }

  if (isStableToken(params.outputToken.address)) {
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

