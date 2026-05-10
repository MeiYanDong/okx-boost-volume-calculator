const AUTH_STORAGE_KEY = "okx-boost:auth-session:v1";
const ACCESS_HEADER = "x-okx-boost-access";

export type AuthUser = {
  id: string;
  email: string;
  role?: "admin" | "user";
  status?: "active" | "disabled";
  maxWallets?: number;
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

export type AdminUserProfile = {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  maxWallets: number;
  dailyRefreshLimit: number;
  dailyRescanLimit: number;
  workspaceCount: number;
  walletCount: number;
  createdAt: string;
  updatedAt: string;
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

export async function refreshAuthProfile(session: AuthSession): Promise<AuthSession | null> {
  const response = await fetch("/api/auth?action=me", {
    method: "GET",
    headers: authHeaders(session),
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => ({}))) as { user?: unknown };
  if (!isAuthUser(payload.user)) return null;
  return { ...session, user: payload.user };
}

export async function createAdminInvite(
  params: {
    email: string;
    role: "admin" | "user";
    maxWallets: number;
    expiresInDays: number;
  },
  auth: { accessPassword?: string; session?: AuthSession | null },
): Promise<CreatedInvite> {
  const payload = await authRequest(
    {
      action: "create-invite",
      email: params.email,
      role: params.role,
      maxWallets: params.maxWallets,
      expiresInDays: params.expiresInDays,
    },
    adminHeaders(auth),
  );
  if (!isObject(payload) || typeof payload.code !== "string" || !isAdminInvite(payload.invite)) {
    throw new Error("创建邀请码响应不完整。");
  }
  return { code: payload.code, invite: payload.invite };
}

export async function listAdminInvites(auth: { accessPassword?: string; session?: AuthSession | null }): Promise<AdminInvite[]> {
  const payload = await authRequest({ action: "list-invites" }, adminHeaders(auth));
  if (!isObject(payload) || !Array.isArray(payload.invites)) throw new Error("邀请码列表响应不完整。");
  return payload.invites.filter(isAdminInvite);
}

export async function revokeAdminInvite(
  inviteId: string,
  auth: { accessPassword?: string; session?: AuthSession | null },
): Promise<AdminInvite> {
  const payload = await authRequest({ action: "revoke-invite", inviteId }, adminHeaders(auth));
  if (!isObject(payload) || !isAdminInvite(payload.invite)) throw new Error("撤销邀请码响应不完整。");
  return payload.invite;
}

export async function listAdminUsers(auth: { accessPassword?: string; session?: AuthSession | null }): Promise<AdminUserProfile[]> {
  const payload = await authRequest({ action: "list-users" }, adminHeaders(auth));
  if (!isObject(payload) || !Array.isArray(payload.users)) throw new Error("用户列表响应不完整。");
  return payload.users.filter(isAdminUserProfile);
}

export async function updateAdminUser(
  params: {
    userId: string;
    status?: "active" | "disabled";
    maxWallets?: number;
  },
  auth: { accessPassword?: string; session?: AuthSession | null },
): Promise<AdminUserProfile> {
  const payload = await authRequest({ action: "update-user", ...params }, adminHeaders(auth));
  if (!isObject(payload) || !isAdminUserProfile(payload.user)) throw new Error("用户更新响应不完整。");
  return payload.user;
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

function adminHeaders(auth: { accessPassword?: string; session?: AuthSession | null }): Record<string, string> {
  if (auth.session?.accessToken) return authHeaders(auth.session);
  const password = String(auth.accessPassword || "").trim();
  return password ? { [ACCESS_HEADER]: password } : {};
}

function parseSessionPayload(payload: unknown): AuthSession {
  const session = isObject(payload) ? payload.session : null;
  if (!isAuthSession(session)) throw new Error("认证响应缺少会话信息。");
  return session;
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isObject(value) || !isAuthUser(value.user)) return false;
  return (
    typeof value.accessToken === "string" &&
    typeof value.refreshToken === "string" &&
    typeof value.expiresAt === "number"
  );
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    (value.role === undefined || value.role === "admin" || value.role === "user") &&
    (value.status === undefined || value.status === "active" || value.status === "disabled") &&
    (value.maxWallets === undefined || typeof value.maxWallets === "number")
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

function isAdminUserProfile(value: unknown): value is AdminUserProfile {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    (value.role === "admin" || value.role === "user") &&
    (value.status === "active" || value.status === "disabled") &&
    typeof value.maxWallets === "number" &&
    typeof value.dailyRefreshLimit === "number" &&
    typeof value.dailyRescanLimit === "number" &&
    typeof value.workspaceCount === "number" &&
    typeof value.walletCount === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
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
