import { createHmac } from "node:crypto";
import { buildFeishuRealDataTestMessage } from "./feishuDrill.mjs";
import { getSupabaseUserFromRequest, getUserNotificationTarget } from "./supabaseStore.mjs";

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

export function createProxyConfig(env) {
  const rawBscRpcUrl = envValue(env, "BSC_RPC_URL", "VITE_BSC_RPC_URL");
  const rawAnkrMultichainRpcUrl = normalizeAnkrRpcUrl(
    envValue(env, "ANKR_MULTICHAIN_RPC_URL", "VITE_ANKR_MULTICHAIN_RPC_URL") || deriveAnkrMultichainUrl(rawBscRpcUrl),
  );
  return {
    accessPassword: envValue(env, "ACCESS_PASSWORD"),
    bscRpcUrl: rawBscRpcUrl || deriveAnkrBscRpcUrl(rawAnkrMultichainRpcUrl) || "https://bsc-rpc.publicnode.com",
    ankrMultichainRpcUrl: rawAnkrMultichainRpcUrl,
    etherscanApiKey: envValue(env, "ETHERSCAN_API_KEY", "VITE_ETHERSCAN_API_KEY"),
    etherscanApiUrl: "https://api.etherscan.io/v2/api",
  };
}

export function warnLegacyEnv(env, primary, legacy) {
  if (!env[primary] && env[legacy]) {
    console.warn(`${legacy} is supported for compatibility, but ${primary} is safer because it is not client-exposed.`);
  }
}

export async function handleRpcProxy(request, response, config, env = process.env) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" });
    return;
  }

  await validateServiceAccess(request, config, env);
  const body = await readJsonBody(request);
  validateRpcBody(body);
  const payload = await postJson(config.bscRpcUrl, body);
  sendJson(response, 200, payload, { "cache-control": "no-store" });
}

export async function handleAnkrProxy(request, response, config, env = process.env) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" });
    return;
  }

  await validateServiceAccess(request, config, env);
  if (!config.ankrMultichainRpcUrl) {
    sendJson(response, 200, jsonRpcError("Ankr Advanced API is not configured"), { "cache-control": "no-store" });
    return;
  }

  const body = await readJsonBody(request);
  validateAnkrBody(body);
  const payload = await postJson(config.ankrMultichainRpcUrl, body);
  sendJson(response, 200, payload, { "cache-control": "no-store" });
}

export async function handleExplorerProxy(request, response, config, url = requestUrl(request), env = process.env) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Use GET" });
    return;
  }

  await validateServiceAccess(request, config, env);
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

export async function handleFeishuNotify(request, response, config, env = process.env) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" });
    return;
  }

  const body = await readJsonBody(request);
  const auth = await getSupabaseUserFromRequest(request, env).catch(() => null);
  if (auth?.user?.id) {
    const target = await getUserNotificationTarget(env, auth.user);
    if (!target.enabled) {
      sendJson(response, 400, { error: "Feishu webhook is not enabled for this user" }, { "cache-control": "no-store" });
      return;
    }
    const drill =
      body?.mode === "real-data-test"
        ? await buildFeishuRealDataTestMessage({
            env,
            user: auth.user,
            config,
            notifyFutureDays: target.notifyFutureDays,
          })
        : null;
    const text = drill ? drill.text : validateFeishuNotifyBody(body);
    await sendFeishuText(text, {
      ...config,
      feishuWebhookUrl: target.webhookUrl,
      feishuWebhookSecret: target.webhookSecret,
    });
    sendJson(
      response,
      200,
      {
        ok: true,
        provider: "supabase",
        mode: drill ? "real-data-test" : "text",
        snapshotDate: drill?.snapshotDate,
        summary: drill?.summary,
      },
      { "cache-control": "no-store" },
    );
    return;
  }

  sendJson(response, 401, { error: "请先登录账号并配置个人飞书 Webhook。" }, { "cache-control": "no-store" });
}

export async function sendFeishuText(text, config) {
  if (!config.feishuWebhookUrl) throw new Error("Feishu webhook is not configured");
  validateFeishuWebhookUrl(config.feishuWebhookUrl);
  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("Feishu notify text is empty");
  if (cleanText.length > 4000) throw new Error("Feishu notify text is too large");
  const payload = createFeishuTextPayload(cleanText, config);
  const result = await postJson(config.feishuWebhookUrl, payload);
  const resultCode = result?.code ?? result?.StatusCode ?? 0;
  if (Number(resultCode) !== 0) {
    throw new Error(`Feishu notify failed: ${result?.msg || result?.message || result?.StatusMessage || "unknown error"}`);
  }
  return result;
}

export function handleUnknownApi(response) {
  sendJson(response, 404, { error: "Unknown API endpoint" });
}

export function sendProxyError(response, error, config) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  sendJson(
    response,
    status,
    { error: redact(error instanceof Error ? error.message : String(error), config) },
    { "cache-control": "no-store" },
  );
}

export function applySecurityHeaders(response, isProduction = false) {
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

export function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

export function requestUrl(request) {
  return new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
}

function envValue(env, primary, legacy) {
  return ((env[primary] || (legacy ? env[legacy] : "")) || "").trim();
}

export function validateAccess(request, config) {
  if (!config.accessPassword) return;

  if (hasDirectAccess(request, config)) return;

  const error = new Error("访问密码错误或缺失。");
  error.statusCode = 401;
  throw error;
}

export async function validateServiceAccess(request, config, env = process.env) {
  if (!config.accessPassword) return;
  if (hasDirectAccess(request, config)) return;

  const auth = await getSupabaseUserFromRequest(request, env).catch(() => null);
  if (auth?.profile?.status === "active") return;

  const error = new Error("请登录有效账号或填写私有访问码。");
  error.statusCode = 401;
  throw error;
}

function hasDirectAccess(request, config) {
  const direct = headerValue(request.headers, "x-okx-boost-access");
  const authorization = headerValue(request.headers, "authorization").replace(/^Bearer\s+/i, "");
  if (direct === config.accessPassword || authorization === config.accessPassword) return true;
  return false;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[name.toLowerCase()] || headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
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

export async function readJsonBody(request) {
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

function jsonRpcError(message) {
  return {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message },
  };
}

function parseHexBlock(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return undefined;
  return Number(BigInt(value));
}

function deriveAnkrMultichainUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("ankr.com")) return "";
    const token = ankrTokenFromUrl(url);
    return token ? `https://rpc.ankr.com/multichain/${token}` : "";
  } catch {
    return "";
  }
}

function deriveAnkrBscRpcUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("ankr.com")) return "";
    const token = ankrTokenFromUrl(url);
    return token ? `https://rpc.ankr.com/bsc/${token}` : "";
  } catch {
    return "";
  }
}

function normalizeAnkrRpcUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("ankr.com")) return rawUrl;
    const segments = url.pathname.split("/").filter(Boolean);
    const service = segments.find((segment) => ["bsc", "multichain"].includes(segment));
    const token = ankrTokenFromUrl(url);
    return service && token ? `https://rpc.ankr.com/${service}/${token}` : rawUrl;
  } catch {
    return rawUrl;
  }
}

function ankrTokenFromUrl(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const serviceIndex = segments.findIndex((segment) => ["bsc", "multichain"].includes(segment));
  if (serviceIndex >= 0 && segments[serviceIndex + 1]) return segments[serviceIndex + 1];
  return segments.find((segment) => /^[a-fA-F0-9]{32,}$/.test(segment)) || "";
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redact(value, config) {
  let output = String(value);
  for (const secret of [
    config.bscRpcUrl,
    config.ankrMultichainRpcUrl,
    config.etherscanApiKey,
    config.accessPassword,
    config.feishuWebhookUrl,
    config.feishuWebhookSecret,
  ]) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output;
}

function validateFeishuNotifyBody(body) {
  if (!isObject(body) || typeof body.text !== "string") throw new Error("Invalid Feishu notify body");
  const text = body.text.trim();
  if (!text) throw new Error("Feishu notify text is empty");
  if (text.length > 4000) throw new Error("Feishu notify text is too large");
  return text;
}

function validateFeishuWebhookUrl(rawUrl) {
  const url = new URL(rawUrl);
  const allowedHosts = new Set(["open.feishu.cn", "open.larksuite.com"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || !url.pathname.startsWith("/open-apis/bot/v2/hook/")) {
    throw new Error("Feishu webhook URL is invalid");
  }
}

function createFeishuTextPayload(text, config) {
  const payload = {
    msg_type: "text",
    content: { text },
  };
  if (!config.feishuWebhookSecret) return payload;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}\n${config.feishuWebhookSecret}`;
  return {
    ...payload,
    timestamp,
    sign: createHmac("sha256", stringToSign).digest("base64"),
  };
}
