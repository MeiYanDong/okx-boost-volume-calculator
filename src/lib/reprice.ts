import { baseMultiplierFor, boostRuleVersionForTimestamp } from "./boostRules";
import { chainById } from "./chains";
import type { CalculationResult, ParsedSwap } from "./types";

export function repriceCalculationResult(
  result: CalculationResult,
  bonusMultiplierForSwap: (swap: ParsedSwap) => number,
): CalculationResult {
  const swaps = result.swaps.map((swap) => {
    const ruleVersion = boostRuleVersionForTimestamp(swap.timestamp);
    const chain = chainById(swap.chainId);
    const baseMultiplier = baseMultiplierFor(chain, swap.inputToken, swap.outputToken, swap.timestamp);
    const bonusMultiplier = bonusMultiplierForSwap(swap);
    const boostVolume =
      swap.tradeUsd === undefined || baseMultiplier === 0
        ? 0
        : swap.tradeUsd * baseMultiplier * bonusMultiplier;
    const status: ParsedSwap["status"] =
      swap.tradeUsd === undefined ? "partial" : baseMultiplier === 0 ? "excluded" : "counted";

    return {
      ...swap,
      ruleVersion,
      baseMultiplier,
      bonusMultiplier,
      boostVolume,
      status,
      reason:
        status === "excluded"
          ? "Pair is excluded by current Boost token-group rules"
          : status === "partial"
            ? swap.reason
            : undefined,
    };
  });

  const dailyRows = result.dailyRows.map((row) => ({
    ...row,
    txCount: 0,
    boostVolume: 0,
    tradeUsd: 0,
  }));
  const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));

  for (const swap of swaps) {
    const row = dailyMap.get(swap.utcDate);
    if (!row) continue;
    row.txCount += swap.status === "counted" ? 1 : 0;
    row.boostVolume += swap.boostVolume;
    row.tradeUsd += swap.tradeUsd || 0;
  }

  const totalBoostVolume = dailyRows.reduce((sum, row) => sum + row.boostVolume, 0);
  const totalTradeUsd = dailyRows.reduce((sum, row) => sum + row.tradeUsd, 0);

  return {
    ...result,
    averageBoostVolume: totalBoostVolume / 10,
    totalBoostVolume,
    totalTradeUsd,
    dailyRows,
    swaps,
  };
}
