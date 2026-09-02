import assert from "node:assert/strict";
import test from "node:test";

import { cronApiTestHelpers } from "./cronApi.mjs";

const { persistArchiveAndSyncFeishu } = cronApiTestHelpers;

test("archive save failure blocks Feishu synchronization", async () => {
  let syncCalls = 0;
  const outcome = await persistArchiveAndSyncFeishu({
    env: {},
    workspace: { provider: "supabase", workspaceId: "admin-workspace", ownerEmail: "admin@example.com" },
    result: { updatedArchive: { records: [] } },
    dryRun: false,
    saveArchive: async () => {
      throw new Error("database unavailable");
    },
    syncFeishu: async () => {
      syncCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(syncCalls, 0);
  assert.equal(outcome.archiveSaved, false);
  assert.deepEqual(outcome.feishuSync, { ok: true, skipped: true, reason: "archive_save_failed" });
  assert.match(outcome.operationErrors.join("\n"), /归档保存失败：database unavailable/);
});

test("successful archive save synchronizes the same admin workspace archive", async () => {
  const calls = [];
  const archive = { records: [{ name: "wallet-5" }] };
  const outcome = await persistArchiveAndSyncFeishu({
    env: { marker: "env" },
    workspace: { provider: "supabase", workspaceId: "admin-workspace", ownerEmail: "admin@example.com" },
    result: { updatedArchive: archive },
    dryRun: false,
    saveArchive: async (_env, workspace, savedArchive) => calls.push(["save", workspace.workspaceId, savedArchive]),
    syncFeishu: async (_env, params) => {
      calls.push(["sync", params.workspaceId, params.ownerEmail, params.archive]);
      return { ok: true, rows: 1 };
    },
  });

  assert.deepEqual(calls, [
    ["save", "admin-workspace", archive],
    ["sync", "admin-workspace", "admin@example.com", archive],
  ]);
  assert.equal(outcome.archiveSaved, true);
  assert.deepEqual(outcome.feishuSync, { ok: true, rows: 1 });
  assert.deepEqual(outcome.operationErrors, []);
});
