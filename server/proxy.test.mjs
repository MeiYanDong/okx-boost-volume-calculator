import assert from "node:assert/strict";
import test from "node:test";
import { createProxyConfig, proxyTestHelpers, validateServiceAccess } from "./proxy.mjs";

const { getOkxSignedJson } = proxyTestHelpers;

test("active chains default to X Layer only", () => {
  assert.equal(createProxyConfig({}).activeChains, "xlayer");
  assert.equal(createProxyConfig({ ACTIVE_CHAINS: "bsc,xlayer" }).activeChains, "bsc,xlayer");
});

test("admin-only upstream access accepts the server cron secret", async () => {
  const request = {
    headers: {
      "x-okx-boost-internal": "cron-secret",
    },
  };
  await validateServiceAccess(request, { adminOnlyUsage: true, cronSecret: "cron-secret" }, { NODE_ENV: "production" });
});

test("admin-only upstream access rejects an invalid internal secret", async () => {
  const request = {
    headers: {
      "x-okx-boost-internal": "wrong-secret",
    },
  };
  await assert.rejects(
    validateServiceAccess(request, { adminOnlyUsage: true, cronSecret: "cron-secret" }, { NODE_ENV: "production" }),
    (error) => error?.statusCode === 401,
  );
});

test("OKX 429 retry waits and rebuilds the timestamp and signature", async () => {
  const requests = [];
  const waits = [];
  const timestamps = [new Date("2026-09-02T00:00:00.000Z"), new Date("2026-09-02T00:00:01.000Z")];
  const fetchJson = async (_url, init) => {
    requests.push(init.headers);
    if (requests.length === 1) {
      const error = new Error("Upstream HTTP 429");
      error.statusCode = 429;
      error.retryAfterMs = 250;
      throw error;
    }
    return { code: "0", data: [] };
  };

  const payload = await getOkxSignedJson(
    new URL("https://web3.okx.com/api/v5/xlayer/address/normal-transaction-list?address=0x1"),
    {
      okxXLayerApiKey: "key",
      okxXLayerApiSecret: "secret",
      okxXLayerApiPassphrase: "passphrase",
    },
    {
      fetchJson,
      now: () => timestamps.shift(),
      delay: async (milliseconds) => waits.push(milliseconds),
      random: () => 0,
    },
  );

  assert.deepEqual(payload, { code: "0", data: [] });
  assert.deepEqual(waits, [500]);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0]["OK-ACCESS-TIMESTAMP"], requests[1]["OK-ACCESS-TIMESTAMP"]);
  assert.notEqual(requests[0]["OK-ACCESS-SIGN"], requests[1]["OK-ACCESS-SIGN"]);
});
