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
  const password = readServerAccessPassword();
  if (password) return { ...headers, [ACCESS_HEADER]: password };
  const token = readAuthAccessToken();
  return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
}

function readAuthAccessToken(): string {
  const storage = safeStorage();
  if (!storage) return "";
  try {
    const session = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || "null") as { accessToken?: unknown } | null;
    return typeof session?.accessToken === "string" ? session.accessToken : "";
  } catch {
    return "";
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
