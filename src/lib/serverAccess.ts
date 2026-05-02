const ACCESS_STORAGE_KEY = "okx-boost:access-password:v1";
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
  return password ? { ...headers, [ACCESS_HEADER]: password } : headers;
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
