const origin = String(process.env.APP_ORIGIN || "https://okx-boost-volume-calculator.vercel.app").replace(/\/+$/, "");
const expectPaused = process.argv.includes("--expect-paused");

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const homepage = await request("/");
assert(homepage.status === 200, `Homepage returned HTTP ${homepage.status}`);
assert(
  typeof homepage.body === "string" && homepage.body.includes('<div id="root"></div>'),
  "Homepage shell is missing",
);

const cron = await request("/api/cron/daily-refresh");
const rpc = await request("/api/rpc?chain=xlayer", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
});

if (expectPaused) {
  assert(cron.status === 200 && cron.body?.paused === true, "Cron is not reporting the expected paused state");
  assert(
    rpc.status === 503 && /暂停|paused/i.test(String(rpc.body?.error || "")),
    "RPC is not blocked by the pause switch",
  );
}

console.log(
  JSON.stringify(
    {
      origin,
      homepage: homepage.status,
      cron: { status: cron.status, paused: cron.body?.paused === true },
      rpc: { status: rpc.status, error: rpc.body?.error || null },
    },
    null,
    2,
  ),
);
