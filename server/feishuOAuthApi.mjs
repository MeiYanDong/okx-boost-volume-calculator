import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getFeishuBaseSyncConfig, normalizeOAuthToken } from "./feishuBaseSync.mjs";
import { requestUrl, sendJson, validateAccess } from "./proxy.mjs";
import {
  getSupabaseUserFromRequest,
  getUserArchive,
  getWorkspaceOAuthContext,
  saveWorkspaceFeishuBaseOAuth,
} from "./supabaseStore.mjs";

const DEFAULT_BASE_SCOPE = [
  "offline_access",
  "base:field:read",
  "base:record:read",
  "base:record:retrieve",
  "base:record:create",
  "base:record:update",
].join(" ");

export async function handleFeishuOAuthStartApi(request, response, config, env = process.env) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  const syncConfig = getFeishuBaseSyncConfig(env);
  if (!syncConfig.appId || !syncConfig.appSecret) {
    sendJson(response, 503, { error: "feishu_credentials_missing" });
    return;
  }

  const url = requestUrl(request);
  const redirectUri = feishuOAuthRedirectUri(request, env);
  const workspaceId = await resolveAuthorizedWorkspaceId(request, config, env, url);
  const context = await getWorkspaceOAuthContext(env, workspaceId);
  if (!context) {
    sendJson(response, 404, { error: "workspace_not_found" });
    return;
  }
  if (context.profile.role !== "admin" || context.profile.status !== "active") {
    sendJson(response, 403, { error: "admin_required" });
    return;
  }

  const state = signOAuthState(
    {
      workspaceId: context.workspace.id,
      ownerId: context.workspace.owner_id,
      ownerEmail: context.profile.email,
      redirectUri,
      nonce: randomBytes(12).toString("hex"),
      exp: Date.now() + 10 * 60 * 1000,
    },
    syncConfig,
  );

  const authUrl = new URL("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
  authUrl.searchParams.set("client_id", syncConfig.appId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", DEFAULT_BASE_SCOPE);
  authUrl.searchParams.set("state", state);

  sendJson(
    response,
    200,
    {
      ok: true,
      authorizationUrl: authUrl.toString(),
      redirectUri,
      workspaceId: context.workspace.id,
    },
    { "cache-control": "no-store" },
  );
}

export async function handleFeishuOAuthCallbackApi(request, response, env = process.env) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  const syncConfig = getFeishuBaseSyncConfig(env);
  const url = requestUrl(request);
  const code = String(url.searchParams.get("code") || "").trim();
  const stateText = String(url.searchParams.get("state") || "").trim();
  if (!code || !stateText) {
    sendHtml(response, 400, oauthHtml("飞书授权失败", "缺少授权 code 或 state。"));
    return;
  }

  try {
    const state = verifyOAuthState(stateText, syncConfig);
    if (!state.workspaceId || !state.redirectUri || Number(state.exp || 0) < Date.now()) {
      throw new Error("OAuth state expired or invalid");
    }
    const context = await getWorkspaceOAuthContext(env, state.workspaceId);
    if (!context || context.workspace.owner_id !== state.ownerId) {
      throw new Error("OAuth workspace mismatch");
    }
    if (context.profile.role !== "admin" || context.profile.status !== "active") {
      throw new Error("OAuth owner is not an active admin");
    }

    const token = await exchangeAuthorizationCode(syncConfig, code, state.redirectUri);
    await saveWorkspaceFeishuBaseOAuth(env, state.workspaceId, {
      ...token,
      appId: syncConfig.appId,
      ownerId: context.workspace.owner_id,
      ownerEmail: context.profile.email,
    });

    sendHtml(
      response,
      200,
      oauthHtml("飞书授权完成", "OKX Boost 已获得写入目标多维表格所需的用户授权。可以关闭此页面，回到 OKX Boost。"),
    );
  } catch (error) {
    sendHtml(response, 500, oauthHtml("飞书授权失败", error?.message || String(error)));
  }
}

async function resolveAuthorizedWorkspaceId(request, config, env, url) {
  const auth = await getSupabaseUserFromRequest(request, env).catch(() => null);
  if (auth?.user?.id && auth?.profile?.role === "admin" && auth.profile.status === "active") {
    const saved = await getUserArchive(env, auth.user);
    return saved.workspaceId;
  }

  validateAccess(request, config, env);
  const syncConfig = getFeishuBaseSyncConfig(env);
  return url.searchParams.get("workspace") || syncConfig.allowedWorkspaceId;
}

async function exchangeAuthorizationCode(syncConfig, code, redirectUri) {
  const json = await feishuTokenFetch(syncConfig, {
    grant_type: "authorization_code",
    client_id: syncConfig.appId,
    client_secret: syncConfig.appSecret,
    code,
    redirect_uri: redirectUri,
  });
  return normalizeOAuthToken(json?.data || json);
}

async function feishuTokenFetch(syncConfig, body) {
  const response = await fetch(`${syncConfig.openApiOrigin.replace(/\/+$/, "")}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok || (json?.code != null && Number(json.code) !== 0)) {
    throw new Error(`Feishu OAuth failed: ${json?.msg || json?.message || text || response.status}`);
  }
  return json;
}

function feishuOAuthRedirectUri(request, env) {
  const configured = String(env.FEISHU_OAUTH_REDIRECT_URI || "").trim();
  if (configured) return configured;
  const origin =
    String(env.PUBLIC_APP_ORIGIN || env.APP_ORIGIN || "")
      .trim()
      .replace(/\/+$/, "") || requestOrigin(request);
  return `${origin}/api/feishu-oauth-callback`;
}

function requestOrigin(request) {
  const proto = headerValue(request.headers, "x-forwarded-proto") || "https";
  const host = headerValue(request.headers, "x-forwarded-host") || headerValue(request.headers, "host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function signOAuthState(payload, syncConfig) {
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", stateSecret(syncConfig)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyOAuthState(state, syncConfig) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) throw new Error("OAuth state malformed");
  const expected = createHmac("sha256", stateSecret(syncConfig)).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) throw new Error("OAuth state signature mismatch");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

function stateSecret(syncConfig) {
  return syncConfig.appSecret || syncConfig.appId || "okx-boost-feishu-oauth";
}

function base64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function oauthHtml(title, message) {
  const cleanTitle = escapeHtml(title);
  const cleanMessage = escapeHtml(message);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cleanTitle}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f0a;color:#eef7e8}.box{max-width:560px;padding:32px;border:1px solid #26331f;border-radius:8px;background:#11180f}h1{margin:0 0 12px;font-size:24px}p{margin:0;line-height:1.7;color:#cbd8c4}</style></head><body><main class="box"><h1>${cleanTitle}</h1><p>${cleanMessage}</p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[name.toLowerCase()] || headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}
