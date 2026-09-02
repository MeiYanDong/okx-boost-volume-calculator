import assert from "node:assert/strict";
import test from "node:test";

import { calculatorTestHelpers } from "./calculator";
import { X_LAYER_CHAIN } from "./chains";
import type { CalculationResult, ChainId, ParsedSwap } from "./types";

const { mergeMultiChainResults } = calculatorTestHelpers;

function swap(hash: string, chainId: ChainId, utcDate: string, boostVolume: number): ParsedSwap {
  return {
    hash,
    chainId,
    chainName: chainId === "xlayer" ? "X Layer" : "BNB Smart Chain",
    timestamp: Date.parse(`${utcDate}T12:00:00Z`) / 1_000,
    utcDate,
    sender: "0x0000000000000000000000000000000000000001",
    router: "0x0000000000000000000000000000000000000002",
    inputToken: { address: "0x0000000000000000000000000000000000000003", symbol: "QIC", decimals: 18, group: "other" },
    outputToken: {
      address: "0x0000000000000000000000000000000000000004",
      symbol: "USDt0",
      decimals: 6,
      group: "group1",
    },
    inputAmount: boostVolume,
    outputAmount: boostVolume,
    tradeUsd: boostVolume,
    usdBasis: "test",
    baseMultiplier: 0.5,
    bonusMultiplier: 1.2,
    boostVolume,
    status: "counted",
  };
}

function result(chainId: ChainId, swaps: ParsedSwap[]): CalculationResult {
  return {
    activeChainIds: [chainId],
    windowStart: "2026-07-01",
    windowEnd: "2026-07-10",
    averageBoostVolume: 0,
    totalBoostVolume: 0,
    totalTradeUsd: 0,
    dailyRows: [],
    swaps,
    warnings: [],
    txHashes: swaps.map((item) => item.hash),
    scannedFromBlock: 100,
    scannedToBlock: 200,
    txDiscoverySource: "explorer",
    chainScans: {
      [chainId]: {
        scannedFromBlock: 100,
        scannedToBlock: 200,
        txDiscoverySource: "explorer",
        txHashes: swaps.map((item) => item.hash),
      },
    },
  };
}

test("X Layer-only refresh preserves in-window BSC history and drops expired BSC hashes", () => {
  const currentXLayer = swap("0xxlayer", "xlayer", "2026-07-10", 120);
  const retainedBsc = swap("0xbsc-retained", "bsc", "2026-07-05", 80);
  const expiredBsc = swap("0xbsc-expired", "bsc", "2026-06-30", 40);
  const previous = result("bsc", [retainedBsc, expiredBsc]);

  const merged = mergeMultiChainResults(
    {
      chains: [X_LAYER_CHAIN],
      endDate: "2026-07-10",
      previousResult: previous,
    },
    [{ chain: X_LAYER_CHAIN, result: result("xlayer", [currentXLayer]) }],
    [],
  );

  assert.deepEqual(merged.activeChainIds, ["xlayer"]);
  assert.deepEqual(merged.swaps.map((item) => item.hash).sort(), ["0xbsc-retained", "0xxlayer"]);
  assert.deepEqual(merged.chainScans?.bsc?.txHashes, ["0xbsc-retained"]);
  assert.deepEqual(merged.txHashes, ["xlayer:0xxlayer"]);
  assert.equal(merged.totalBoostVolume, 200);
  assert.equal(merged.dailyRows.find((row) => row.date === "2026-07-05")?.boostVolume, 80);
  assert.match(merged.warnings.join("\n"), /未启用链沿用当前窗口归档交易 1 笔/);
});
