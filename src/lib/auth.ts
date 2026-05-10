const AUTH_STORAGE_KEY = "okx-boost:auth-session:v1";
const ACCESS_HEADER = "x-okx-boost-access";

export type AuthUser = {
  id: string;
  email: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
};

export type AuthMode = "signin" | "redeem";

export type AdminInvite = {
  id: string;
  email: string;
  role: "admin" | "user";
  maxWallets: number;
  dailyRefreshLimit: number;
  dailyRescanLimit: number;
  expiresAt: string;
  usedAt: string;
  usedBy: string;
  createdAt: string;
};

export type CreatedInvite = {
  code: string;
  invite: AdminInvite;
};

export function readAuthSession(): AuthSession | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || "null") as AuthSession | null;
    return isAuthSession(parsed) ? parsed : null;
  } catch {
    storage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function writeAuthSession(session: AuthSession | null) {
  const storage = safeStorage();
  if (!storage) return;
  if (!session) {
    storage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function authHeaders(session: AuthSession | null, headers: Record<string, string> = {}): Record<string, string> {
  return session?.accessToken ? { ...headers, authorization: `Bearer ${session.accessToken}` } : headers;
}

export function shouldRefreshSession(session: AuthSession | null): boolean {
  if (!session) return false;
  return session.expiresAt - Math.floor(Date.now() / 1000) < 5 * 60;
}

export async function signInWithEmail(email: string, password: string): Promise<AuthSession> {
  const payload = await authRequest({ action: "sign-in", email, password });
  return parseSessionPayload(payload);
}

export async function redeemInvite(params: {
  inviteCode: string;
  email: string;
  password: string;
}): Promise<AuthSession> {
  const payload = await authRequest({ action: "redeem", ...params });
  return parseSessionPayload(payload);
}

export async function refreshAuthSession(refreshToken: string): Promise<AuthSession> {
  const payload = await authRequest({ action: "refresh", refreshToken });
  return parseSessionPayload(payload);
}

export async function validateAuthSession(session: AuthSession): Promise<boolean> {
  const response = await fetch("/api/auth?action=me", {
    method: "GET",
    headers: authHeaders(session),
  });
  if (!response.ok) return false;
  const payload = (await response.json().catch(() => ({}))) as { user?: AuthUser | null };
  return Boolean(payload.user?.id);
}

export async function createAdminInvite(
  params: {
    email: string;
    maxWallets: number;
    expiresInDays: number;
  },
  accessPassword: string,
): Promise<CreatedInvite> {
  const payload = await authRequest(
    {
      action: "create-invite",
      email: params.email,
      maxWallets: params.maxWallets,
      expiresInDays: params.expiresInDays,
    },
    adminHeaders(accessPassword),
  );
  if (!isObject(payload) || typeof payload.code !== "string" || !isAdminInvite(payload.invite)) {
    throw new Error("创建邀请码响应不完整。");
  }
  return { code: payload.code, invite: payload.invite };
}

export async function listAdminInvites(accessPassword: string): Promise<AdminInvite[]> {
  const payload = await authRequest({ action: "list-invites" }, adminHeaders(accessPassword));
  if (!isObject(payload) || !Array.isArray(payload.invites)) throw new Error("邀请码列表响应不完整。");
  return payload.invites.filter(isAdminInvite);
}

export async function revokeAdminInvite(inviteId: string, accessPassword: string): Promise<AdminInvite> {
  const payload = await authRequest({ action: "revoke-invite", inviteId }, adminHeaders(accessPassword));
  if (!isObject(payload) || !isAdminInvite(payload.invite)) throw new Error("撤销邀请码响应不完整。");
  return payload.invite;
}

async function authRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `认证请求失败 HTTP ${response.status}`);
  return payload;
}

function adminHeaders(accessPassword: string): Record<string, string> {
  const password = accessPassword.trim();
  return password ? { [ACCESS_HEADER]: password } : {};
}

function parseSessionPayload(payload: unknown): AuthSession {
  const session = isObject(payload) ? payload.session : null;
  if (!isAuthSession(session)) throw new Error("认证响应缺少会话信息。");
  return session;
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isObject(value) || !isObject(value.user)) return false;
  return (
    typeof value.accessToken === "string" &&
    typeof value.refreshToken === "string" &&
    typeof value.expiresAt === "number" &&
    typeof value.user.id === "string" &&
    typeof value.user.email === "string"
  );
}

function isAdminInvite(value: unknown): value is AdminInvite {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    (value.role === "admin" || value.role === "user") &&
    typeof value.maxWallets === "number" &&
    typeof value.dailyRefreshLimit === "number" &&
    typeof value.dailyRescanLimit === "number" &&
    typeof value.expiresAt === "string" &&
    typeof value.usedAt === "string" &&
    typeof value.usedBy === "string" &&
    typeof value.createdAt === "string"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
