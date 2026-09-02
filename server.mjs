import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, loadEnv } from "vite";
import {
  applySecurityHeaders,
  createProxyConfig,
  handleAnkrProxy,
  handleExplorerProxy,
  handleFeishuNotify,
  handleRpcProxy,
  handleUnknownApi,
  requestUrl,
  sendProxyError,
  warnLegacyEnv,
} from "./server/proxy.mjs";
import { handleArchiveApi } from "./server/archiveApi.mjs";
import { handleAuthApi } from "./server/authApi.mjs";
import { handleDailyRefreshCron } from "./server/cronApi.mjs";
import { handleFeishuBaseSyncApi } from "./server/feishuBaseSync.mjs";
import { handleFeishuOAuthCallbackApi, handleFeishuOAuthStartApi } from "./server/feishuOAuthApi.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const mode = process.env.NODE_ENV === "production" ? "production" : "development";
const isProduction = mode === "production";
const modeEnv = loadEnv(mode, root, "");
const productionFallbackEnv = mode === "development" ? pickLocalFallbackEnv(loadEnv("production", root, "")) : {};
const env = {
  ...productionFallbackEnv,
  ...modeEnv,
  ...process.env,
};
const port = Number(env.PORT || 5173);
const config = createProxyConfig(env);

warnLegacyEnv(env, "BSC_RPC_URL", "VITE_BSC_RPC_URL");
warnLegacyEnv(env, "ANKR_MULTICHAIN_RPC_URL", "VITE_ANKR_MULTICHAIN_RPC_URL");
warnLegacyEnv(env, "ETHERSCAN_API_KEY", "VITE_ETHERSCAN_API_KEY");

const vite = isProduction
  ? null
  : await createViteServer({
      root,
      appType: "spa",
      clearScreen: false,
      server: { middlewareMode: true },
    });

const server = createServer(async (request, response) => {
  try {
    applySecurityHeaders(response, isProduction);
    const url = requestUrl(request);

    if (url.pathname === "/api/rpc") {
      await handleRpcProxy(request, response, config, env);
      return;
    }

    if (url.pathname === "/api/ankr") {
      await handleAnkrProxy(request, response, config, env);
      return;
    }

    if (url.pathname === "/api/explorer") {
      await handleExplorerProxy(request, response, config, url, env);
      return;
    }

    if (url.pathname === "/api/feishu") {
      await handleFeishuNotify(request, response, config, env);
      return;
    }

    if (url.pathname === "/api/feishu-sync") {
      await handleFeishuBaseSyncApi(request, response, config, env);
      return;
    }

    if (url.pathname === "/api/feishu-oauth-start") {
      await handleFeishuOAuthStartApi(request, response, config, env);
      return;
    }

    if (url.pathname === "/api/feishu-oauth-callback") {
      await handleFeishuOAuthCallbackApi(request, response, env);
      return;
    }

    if (url.pathname === "/api/archive") {
      await handleArchiveApi(request, response, config, env);
      return;
    }

    if (url.pathname === "/api/auth") {
      await handleAuthApi(request, response, config, env);
      return;
    }

    if (url.pathname === "/api/cron/daily-refresh") {
      await handleDailyRefreshCron(request, response, config, env);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      handleUnknownApi(response);
      return;
    }

    if (vite) {
      vite.middlewares(request, response);
      return;
    }

    serveStatic(response, url.pathname);
  } catch (error) {
    sendProxyError(response, error, config);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`OKX Boost server listening on http://127.0.0.1:${port}`);
});

function serveStatic(response, pathname) {
  const dist = resolve(root, "dist");
  const requested = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = requested === "/" ? join(dist, "index.html") : join(dist, requested);
  const resolved = resolve(filePath);
  const target = resolved.startsWith(dist) && existsSync(resolved) && statSync(resolved).isFile() ? resolved : join(dist, "index.html");
  response.writeHead(200, { "content-type": mimeType(target) });
  createReadStream(target).pipe(response);
}

function mimeType(pathname) {
  const ext = extname(pathname);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function pickLocalFallbackEnv(source) {
  const allowed = new Set([
    "ACCESS_PASSWORD",
    "ANKR_MULTICHAIN_RPC_URL",
    "BSC_RPC_URL",
    "XLAYER_RPC_URL",
    "ETHERSCAN_API_KEY",
    "OKX_XLAYER_API_KEY",
    "OKX_XLAYER_API_SECRET",
    "OKX_XLAYER_API_PASSPHRASE",
    "OKX_XLAYER_EXPLORER_API_URL",
    "PUBLIC_APP_ORIGIN",
    "APP_ORIGIN",
    "CRON_SECRET",
    "ACTIVE_CHAINS",
    "VITE_ACTIVE_CHAINS",
    "RPC_USAGE_PAUSED",
    "OKX_BOOST_RPC_PAUSED",
    "ADMIN_ONLY_USAGE",
    "OKX_BOOST_ADMIN_ONLY",
    "FEISHU_WEBHOOK_URL",
    "FEISHU_WEBHOOK_SECRET",
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_BASE_TOKEN",
    "FEISHU_BASE_TABLE_ID",
    "FEISHU_BASE_SYNC_ENABLED",
    "FEISHU_BASE_SYNC_DISABLED",
    "FEISHU_BASE_SYNC_WORKSPACE_ID",
    "FEISHU_BASE_SYNC_OWNER_EMAIL",
    "FEISHU_BASE_SYNC_START_DATE",
    "FEISHU_BASE_SYNC_DRY_RUN",
    "FEISHU_BASE_DEFAULT_BOOST_MULTIPLIER",
    "FEISHU_BASE_DEFAULT_BONUS_RATE",
    "FEISHU_BASE_DEFAULT_SERVICE_FEE_RATE",
    "LARK_APP_ID",
    "LARK_APP_SECRET",
    "LARK_BASE_TOKEN",
    "LARK_BASE_TABLE_ID",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "KV_REST_API_READ_ONLY_TOKEN",
    "KV_URL",
    "REDIS_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
  ]);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key) && String(value || "").trim()));
}
