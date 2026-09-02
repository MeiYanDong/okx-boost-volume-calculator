import assert from "node:assert/strict";
import test from "node:test";
import { feishuBaseSyncTestHelpers, getFeishuBaseSyncConfig } from "./feishuBaseSync.mjs";

const { buildSyncRowsFromArchive, isAllowedSyncTarget, makeExistingIndex, makeFieldMap, splitExistingRecordsByDates } =
  feishuBaseSyncTestHelpers;

const accountOptions = Array.from({ length: 16 }, (_, index) => ({ name: `okxboost-${index + 1}` }));
const fields = [
  { field_id: "date", field_name: "日期", type: 5 },
  { field_id: "account", field_name: "账户", type: 3, property: { options: accountOptions } },
  { field_id: "token", field_name: "代币", type: 3, property: { options: [{ name: "QIC" }] } },
  { field_id: "boost", field_name: "Boost 交易量", type: 2 },
  { field_id: "trade", field_name: "成交额", type: 2 },
  { field_id: "wear", field_name: "磨损（不算返佣）", type: 2 },
  { field_id: "multiplier", field_name: "Boost 倍数", type: 2 },
  { field_id: "bonus", field_name: "加成", type: 2 },
  { field_id: "service", field_name: "服务费", type: 2 },
];
const fieldMap = makeFieldMap(fields);
const syncConfig = {
  startDate: "2026-06-18",
  defaultBoostMultiplier: 0.5,
  defaultBonusRate: 0.2,
  defaultServiceFeeRate: 0.005,
};

function swap(tradeUsd, date = "2026-07-09") {
  return {
    status: "counted",
    utcDate: date,
    tradeUsd,
    wearUsd: tradeUsd * 0.004,
    baseMultiplier: 0.5,
    inputToken: { symbol: "QIC" },
    outputToken: { symbol: "USDt0" },
  };
}

function walletLine(index) {
  return `${index} 0x${String(index).padStart(40, "0")}`;
}

test("empty optional rate env values use production defaults", () => {
  const config = getFeishuBaseSyncConfig({
    FEISHU_APP_ID: "app-id",
    FEISHU_APP_SECRET: "app-secret",
    FEISHU_BASE_DEFAULT_BOOST_MULTIPLIER: "",
    FEISHU_BASE_DEFAULT_BONUS_RATE: "",
    FEISHU_BASE_DEFAULT_SERVICE_FEE_RATE: "",
  });
  assert.equal(config.defaultBoostMultiplier, 0.5);
  assert.equal(config.defaultBonusRate, 0.2);
  assert.equal(config.defaultServiceFeeRate, 0.005);
});

test("Feishu sync target requires the exact admin workspace and owner email", () => {
  const config = {
    allowedWorkspaceId: "admin-workspace",
    allowedOwnerEmail: "admin@example.com",
  };

  assert.equal(isAllowedSyncTarget(config, "admin-workspace", "admin@example.com"), true);
  assert.equal(isAllowedSyncTarget(config, "user-workspace", "admin@example.com"), false);
  assert.equal(isAllowedSyncTarget(config, "admin-workspace", "user@example.com"), false);
  assert.equal(isAllowedSyncTarget(config, "admin-workspace", ""), false);
});

test("date rebuild selects only records from the requested date", () => {
  const records = [
    { record_id: "old", fields: { 日期: Date.UTC(2026, 6, 7, 16) } },
    { record_id: "target-a", fields: { 日期: Date.UTC(2026, 6, 8, 16) } },
    { record_id: "target-b", fields: { 日期: "2026-07-09" } },
  ];
  const plan = splitExistingRecordsByDates(records, fieldMap, new Set(["2026-07-09"]));
  assert.deepEqual(plan.deleteRecordIds, ["target-a", "target-b"]);
  assert.deepEqual(
    plan.keptRecords.map((record) => record.record_id),
    ["old"],
  );
});

test("partial archive uses wallet address order instead of the partial records index", () => {
  const archive = {
    walletsText: Array.from({ length: 16 }, (_, index) => walletLine(index + 1)).join("\n"),
    records: [
      {
        address: `0x${String(5).padStart(40, "0")}`,
        name: "5",
        result: { swaps: [swap(100)], dailyRows: [] },
      },
    ],
  };

  const built = buildSyncRowsFromArchive(archive, syncConfig, fieldMap);
  assert.equal(built.rows.length, 1);
  assert.equal(built.rows[0].account, "okxboost-5");
  assert.equal(built.rows[0].key, "2026-07-09|okxboost-5|qic");
});

test("duplicate wrong-account rows are reassigned only when their values match a missing desired row", () => {
  const archive = {
    walletsText: [walletLine(1), walletLine(2)].join("\n"),
    records: [
      {
        address: `0x${String(1).padStart(40, "0")}`,
        name: "1",
        result: { swaps: [swap(100)], dailyRows: [] },
      },
      {
        address: `0x${String(2).padStart(40, "0")}`,
        name: "2",
        result: { swaps: [swap(200)], dailyRows: [] },
      },
    ],
  };
  const desiredRows = buildSyncRowsFromArchive(archive, syncConfig, fieldMap).rows;
  const existingRecords = desiredRows.map((row, index) => ({
    record_id: `rec${index + 1}`,
    fields: {
      日期: Date.UTC(2026, 6, 8, 16),
      账户: "okxboost-1",
      代币: "QIC",
      成交额: row.tradeUsd,
      "磨损（不算返佣）": row.wearGrossUsd,
      "Boost 倍数": index === 0 ? row.boostMultiplier : 1,
      加成: index === 0 ? row.bonusRate : 0,
      服务费: index === 0 ? row.serviceFeeRate : 0,
    },
  }));

  const index = makeExistingIndex(existingRecords, fieldMap, desiredRows);
  assert.equal(index.size, 2);
  assert.equal(index.repairedDuplicates, 1);
  assert.deepEqual(index.warnings, []);
  assert.equal(index.get("2026-07-09|okxboost-2|qic").recordId, "rec2");
});

test("unmatched duplicate rows remain warnings instead of being reassigned", () => {
  const desiredRows = buildSyncRowsFromArchive(
    {
      walletsText: [walletLine(1), walletLine(2)].join("\n"),
      records: [
        {
          address: `0x${String(1).padStart(40, "0")}`,
          name: "1",
          result: { swaps: [swap(100)], dailyRows: [] },
        },
        {
          address: `0x${String(2).padStart(40, "0")}`,
          name: "2",
          result: { swaps: [swap(200)], dailyRows: [] },
        },
      ],
    },
    syncConfig,
    fieldMap,
  ).rows;
  const existingRecords = [100, 999].map((tradeUsd, index) => ({
    record_id: `rec${index + 1}`,
    fields: {
      日期: Date.UTC(2026, 6, 8, 16),
      账户: "okxboost-1",
      代币: "QIC",
      成交额: tradeUsd,
      "磨损（不算返佣）": tradeUsd * 0.004,
      "Boost 倍数": 0.5,
      加成: 0.2,
      服务费: 0.005,
    },
  }));

  const index = makeExistingIndex(existingRecords, fieldMap, desiredRows);
  assert.equal(index.repairedDuplicates, 0);
  assert.equal(index.warnings.length, 1);
});
