import { Redis } from "@upstash/redis";

export const SERVER_ARCHIVE_KEY = "okx-boost:server-archive:v1";
export const SERVER_ARCHIVE_VERSION = 1;

let redisClient;

export function isArchiveStoreConfigured(env = process.env) {
  return Boolean(redisUrl(env) && redisToken(env));
}

export function getArchiveStore(env = process.env) {
  if (!isArchiveStoreConfigured(env)) return null;
  if (!redisClient) {
    redisClient = new Redis({
      url: redisUrl(env),
      token: redisToken(env),
    });
  }
  return redisClient;
}

export async function getServerArchive(env = process.env) {
  const store = getArchiveStore(env);
  if (!store) return null;
  const archive = await store.get(SERVER_ARCHIVE_KEY);
  return isObject(archive) ? archive : null;
}

export async function setServerArchive(archive, env = process.env) {
  const store = getArchiveStore(env);
  if (!store) throw new Error("Server archive store is not configured");
  const payload = {
    version: SERVER_ARCHIVE_VERSION,
    ...archive,
    updatedAt: new Date().toISOString(),
  };
  await store.set(SERVER_ARCHIVE_KEY, payload);
  return payload;
}

function redisUrl(env) {
  return String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim();
}

function redisToken(env) {
  return String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
