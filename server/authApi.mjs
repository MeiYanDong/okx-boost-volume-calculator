import {
  createInvite,
  getUserNotificationSettings,
  getSupabaseUserFromRequest,
  hasActiveAdminProfile,
  isAdminAuth,
  isSupabaseConfigured,
  listAdminUsers,
  listInvites,
  redeemInvite,
  refreshAuthSession,
  revokeInvite,
  signInWithPassword,
  updateUserNotificationSettings,
  updateAdminUser,
} from "./supabaseStore.mjs";
import { readJsonBody, requestUrl, sendJson, validateAccess } from "./proxy.mjs";

export async function handleAuthApi(request, response, config, env = process.env) {
  const url = requestUrl(request);

  if (request.method === "GET") {
    if (url.searchParams.get("action") !== "me") {
      sendJson(response, 405, { error: "Use POST or GET?action=me" }, { "cache-control": "no-store" });
      return;
    }
    const auth = await getSupabaseUserFromRequest(request, env).catch(() => null);
    sendJson(
      response,
      200,
      {
        configured: isSupabaseConfigured(env),
        user: auth?.user
          ? {
              id: auth.user.id,
              email: auth.user.email || "",
              role: auth.profile?.role || "user",
              status: auth.profile?.status || "active",
              maxWallets: Number(auth.profile?.max_wallets || 0),
            }
          : null,
      },
      { "cache-control": "no-store" },
    );
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" }, { "cache-control": "no-store" });
    return;
  }

  const body = await readJsonBody(request);
  const action = String(body?.action || "").trim();

  if (action === "sign-in") {
    const session = await signInWithPassword(body, env);
    sendJson(response, 200, { ok: true, session }, { "cache-control": "no-store" });
    return;
  }

  if (action === "refresh") {
    const session = await refreshAuthSession(body?.refreshToken, env);
    sendJson(response, 200, { ok: true, session }, { "cache-control": "no-store" });
    return;
  }

  if (action === "redeem") {
    const result = await redeemInvite(body, env);
    sendJson(response, 200, { ok: true, ...result }, { "cache-control": "no-store" });
    return;
  }

  if (action === "create-invite") {
    const admin = await validateAdminAccess(request, config, env, { allowCronSecret: true });
    const result = await createInvite(
      {
        ...body,
        role: admin.bootstrap ? "admin" : body.role,
        createdBy: admin.userId,
      },
      env,
    );
    sendJson(response, 200, { ok: true, ...result }, { "cache-control": "no-store" });
    return;
  }

  if (action === "list-invites") {
    await validateAdminAccess(request, config, env);
    const invites = await listInvites(env);
    sendJson(response, 200, { ok: true, invites }, { "cache-control": "no-store" });
    return;
  }

  if (action === "revoke-invite") {
    await validateAdminAccess(request, config, env);
    const invite = await revokeInvite(body, env);
    sendJson(response, 200, { ok: true, invite }, { "cache-control": "no-store" });
    return;
  }

  if (action === "list-users") {
    await validateAdminAccess(request, config, env);
    const users = await listAdminUsers(env);
    sendJson(response, 200, { ok: true, users }, { "cache-control": "no-store" });
    return;
  }

  if (action === "update-user") {
    const admin = await validateAdminAccess(request, config, env);
    const user = await updateAdminUser(body, admin.userId, env);
    sendJson(response, 200, { ok: true, user }, { "cache-control": "no-store" });
    return;
  }

  if (action === "get-notification-settings") {
    const auth = await validateUserAccess(request, env);
    const settings = await getUserNotificationSettings(env, auth.user);
    sendJson(response, 200, { ok: true, settings }, { "cache-control": "no-store" });
    return;
  }

  if (action === "update-notification-settings") {
    const auth = await validateUserAccess(request, env);
    const settings = await updateUserNotificationSettings(env, auth.user, body);
    sendJson(response, 200, { ok: true, settings }, { "cache-control": "no-store" });
    return;
  }

  sendJson(response, 400, { error: "Unknown auth action" }, { "cache-control": "no-store" });
}

async function validateUserAccess(request, env) {
  const auth = await getSupabaseUserFromRequest(request, env);
  if (!auth?.user?.id) {
    const error = new Error("请先登录账号。");
    error.statusCode = 401;
    throw error;
  }
  if (auth.profile?.status && auth.profile.status !== "active") {
    const error = new Error("账号已被禁用。");
    error.statusCode = 403;
    throw error;
  }
  return auth;
}

async function validateAdminAccess(request, config, env, options = {}) {
  const cronSecret = String(env.CRON_SECRET || "").trim();
  const authorization = headerValue(request.headers, "authorization");
  if (options.allowCronSecret && cronSecret && authorization === `Bearer ${cronSecret}`) {
    return { mode: "cron-secret", userId: "", bootstrap: false };
  }

  const adminAuth = await isAdminAuth(request, env);
  if (adminAuth) return { mode: "admin-session", userId: adminAuth.user.id, bootstrap: false };

  const hasAdmin = await hasActiveAdminProfile(env);
  try {
    validateAccess(request, config, env);
    if (!hasAdmin) return { mode: "bootstrap-access", userId: "", bootstrap: true };
    const error = new Error("请先登录管理员账号。私有访问码只用于首个管理员初始化。");
    error.statusCode = 403;
    throw error;
  } catch (error) {
    throw error;
  }
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[name.toLowerCase()] || headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}
