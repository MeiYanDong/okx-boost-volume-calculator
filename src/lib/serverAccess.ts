const ACCESS_STORAGE_KEY = "okx-boost:access-password:v1";
const AUTH_STORAGE_KEY = "okx-boost:auth-session:v1";
const ACCESS_HEADER = "x-okx-boost-access";

export function readServerAccessPassword(): string {
  const storage = safeStorage();
  if (!storage) return "";
  return storage.getItem(ACCESS_STORAGE_KEY) || "";
}

export function writeServerAccessPassword(value: string) {
  const storage = safeStorage();
  if (!storage) return;
  const trimmed = value.trim();
  if (trimmed) storage.setItem(ACCESS_STORAGE_KEY, trimmed);
  else storage.removeItem(ACCESS_STORAGE_KEY);
}

export function serverAccessHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const auth = readAuthAccessState();
  if (auth.token) return { ...headers, authorization: `Bearer ${auth.token}` };
  if (auth.hasSession) return headers;
  const password = readServerAccessPassword();
  return password ? { ...headers, [ACCESS_HEADER]: password } : headers;
}

function readAuthAccessState(): { token: string; hasSession: boolean } {
  const storage = safeStorage();
  if (!storage) return { token: "", hasSession: false };
  try {
    const session = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || "null") as {
      accessToken?: unknown;
      expiresAt?: unknown;
      user?: { status?: unknown };
    } | null;
    if (!session) return { token: "", hasSession: false };
    if (typeof session.accessToken !== "string") return { token: "", hasSession: true };
    if (session.user?.status === "disabled") return { token: "", hasSession: true };
    const expiresAt = typeof session.expiresAt === "number" ? session.expiresAt : 0;
    if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) + 30) return { token: "", hasSession: true };
    return { token: session.accessToken, hasSession: true };
  } catch {
    return { token: "", hasSession: false };
  }
}

function safeStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    return storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
      ? storage
      : null;
  } catch {
    return null;
  }
}
