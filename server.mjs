import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, loadEnv } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const mode = process.env.NODE_ENV === "production" ? "production" : "development";
const isProduction = mode === "production";
const env = { ...loadEnv(mode, root, ""), ...process.env };
const port = Number(env.PORT || 5173);
const maxBodyBytes = 1_000_000;
const upstreamTimeoutMs = 25_000;
const allowedRpcMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_getBlockByNumber",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
]);

const config = {
  bscRpcUrl: envValue("BSC_RPC_URL", "VITE_BSC_RPC_URL") || "https://bsc-rpc.publicnode.com",
  ankrMultichainRpcUrl:
    envValue("ANKR_MULTICHAIN_RPC_URL", "VITE_ANKR_MULTICHAIN_RPC_URL") ||
    deriveAnkrMultichainUrl(envValue("BSC_RPC_URL", "VITE_BSC_RPC_URL")),
  etherscanApiKey: envValue("ETHERSCAN_API_KEY", "VITE_ETHERSCAN_API_KEY"),
  etherscanApiUrl: "https://api.etherscan.io/v2/api",
};

warnLegacyEnv("BSC_RPC_URL", "VITE_BSC_RPC_URL");
warnLegacyEnv("ANKR_MULTICHAIN_RPC_URL", "VITE_ANKR_MULTICHAIN_RPC_URL");
warnLegacyEnv("ETHERSCAN_API_KEY", "VITE_ETHERSCAN_API_KEY");

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
    applySecurityHeaders(response);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/rpc") {
      await handleRpcProxy(request, response);
      return;
    }

    if (url.pathname === "/api/ankr") {
      await handleAnkrProxy(request, response);
      return;
    }

    if (url.pathname === "/api/explorer") {
      await handleExplorerProxy(request, response, url);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Unknown API endpoint" });
      return;
    }

    if (vite) {
      vite.middlewares(request, response);
      return;
    }

    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: redact(error instanceof Error ? error.message : String(error)) });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`OKX Boost server listening on http://127.0.0.1:${port}`);
});

function envValue(primary, legacy) {
  return (env[primary] || env[legacy] || "").trim();
}

function warnLegacyEnv(primary, legacy) {
  if (!env[primary] && env[legacy]) {
    console.warn(`${legacy} is supported for compatibility, but ${primary} is safer because it is not client-exposed.`);
  }
}

async function handleRpcProxy(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" });
    return;
  }

  const body = await readJsonBody(request);
  validateRpcBody(body);
  const payload = await postJson(config.bscRpcUrl, body);
  sendJson(response, 200, payload, { "cache-control": "no-store" });
}

async function handleAnkrProxy(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" });
    return;
  }

  if (!config.ankrMultichainRpcUrl) {
    sendJson(response, 200, jsonRpcError("Ankr Advanced API is not configured"));
    return;
  }

  const body = await readJsonBody(request);
  validateAnkrBody(body);
  const payload = await postJson(config.ankrMultichainRpcUrl, body);
  sendJson(response, 200, payload, { "cache-control": "no-store" });
}

async function handleExplorerProxy(request, response, url) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Use GET" });
    return;
  }

  if (!config.etherscanApiKey) {
    sendJson(response, 200, {
      status: "0",
      message: "NOTOK",
      result: "Etherscan API key is not configured",
    });
    return;
  }

  validateExplorerParams(url.searchParams);
  const upstream = new URL(config.etherscanApiUrl);
  upstream.searchParams.set("chainid", "56");
  upstream.searchParams.set("module", "account");
  upstream.searchParams.set("action", "txlist");
  for (const name of ["address", "startblock", "endblock", "sort", "page", "offset"]) {
    upstream.searchParams.set(name, url.searchParams.get(name) || "");
  }
  upstream.searchParams.set("apikey", config.etherscanApiKey);

  const payload = await getJson(upstream.toString());
  sendJson(response, 200, payload, { "cache-control": "no-store" });
}

function validateRpcBody(body) {
  if (!isObject(body)) throw new Error("Invalid JSON-RPC body");
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string" || !Array.isArray(body.params)) {
    throw new Error("Invalid JSON-RPC request");
  }
  if (!allowedRpcMethods.has(body.method)) {
    throw new Error(`RPC method is not allowed: ${body.method}`);
  }

  if (body.method === "eth_getLogs") {
    const filter = body.params[0];
    if (!isObject(filter)) throw new Error("Invalid eth_getLogs filter");
    const fromBlock = parseHexBlock(filter.fromBlock);
    const toBlock = parseHexBlock(filter.toBlock);
    if (fromBlock === undefined || toBlock === undefined || toBlock < fromBlock || toBlock - fromBlock > 50_000) {
      throw new Error("eth_getLogs block range is invalid or too large");
    }
  }

  for (const value of body.params) {
    if (typeof value === "string" && value.length > 2_000) throw new Error("RPC parameter is too large");
  }
}

function validateAnkrBody(body) {
  if (!isObject(body) || body.jsonrpc !== "2.0" || body.method !== "ankr_getTransactionsByAddress") {
    throw new Error("Only ankr_getTransactionsByAddress is allowed");
  }
  const params = body.params;
  if (!isObject(params)) throw new Error("Invalid Ankr params");
  if (!isAddress(params.address)) throw new Error("Invalid Ankr address");
  if (params.blockchain !== "bsc") throw new Error("Only BSC Ankr queries are allowed");
  if (params.includeLogs !== false) throw new Error("Ankr includeLogs must be false");
  if (!Number.isFinite(Number(params.pageSize)) || Number(params.pageSize) > 100) {
    throw new Error("Ankr pageSize is too large");
  }
  if (params.pageToken !== undefined && String(params.pageToken).length > 512) {
    throw new Error("Ankr pageToken is too large");
  }
}

function validateExplorerParams(params) {
  if (params.get("module") !== "account" || params.get("action") !== "txlist") {
    throw new Error("Only account txlist explorer queries are allowed");
  }
  if (!isAddress(params.get("address") || "")) throw new Error("Invalid explorer address");
  for (const name of ["startblock", "endblock", "page", "offset"]) {
    const value = Number(params.get(name));
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid explorer ${name}`);
  }
  if (Number(params.get("offset")) > 10_000) throw new Error("Explorer offset is too large");
  if (Number(params.get("page")) > 20) throw new Error("Explorer page is too large");
  if (!["asc", "desc"].includes(params.get("sort") || "")) throw new Error("Invalid explorer sort");
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(url) {
  return fetchJson(url, { method: "GET", headers: { accept: "application/json" } });
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Upstream timed out after ${upstreamTimeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function jsonRpcError(message) {
  return {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message },
  };
}

function applySecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  if (isProduction) {
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  }
}

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

function parseHexBlock(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return undefined;
  return Number(BigInt(value));
}

function deriveAnkrMultichainUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("ankr.com")) return "";
    const token = url.pathname.split("/").filter(Boolean).pop();
    return token ? `https://rpc.ankr.com/multichain/${token}` : "";
  } catch {
    return "";
  }
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redact(value) {
  let output = String(value);
  for (const secret of [config.bscRpcUrl, config.ankrMultichainRpcUrl, config.etherscanApiKey]) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output;
}
