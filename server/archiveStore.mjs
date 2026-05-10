import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

export const LEGACY_SERVER_ARCHIVE_KEY = "okx-boost:server-archive:v1";
export const DEFAULT_WORKSPACE_ID = "default";
export const SERVER_ARCHIVE_INDEX_KEY = "okx-boost:server-archive:index:v2";
export const SERVER_ARCHIVE_KEY_PREFIX = "okx-boost:server-archive:v2";
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

export async function getServerArchive(env = process.env, workspaceId = DEFAULT_WORKSPACE_ID) {
  const store = getArchiveStore(env);
  if (!store) return null;
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const archive = await store.get(serverArchiveKey(normalizedWorkspaceId));
  if (isObject(archive)) return archive;
  if (normalizedWorkspaceId === DEFAULT_WORKSPACE_ID) {
    const legacyArchive = await store.get(LEGACY_SERVER_ARCHIVE_KEY);
    return isObject(legacyArchive) ? { ...legacyArchive, workspaceId: DEFAULT_WORKSPACE_ID } : null;
  }
  return null;
}

export async function setServerArchive(archive, env = process.env, workspaceId = DEFAULT_WORKSPACE_ID) {
  const store = getArchiveStore(env);
  if (!store) throw new Error("Server archive store is not configured");
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const payload = {
    version: SERVER_ARCHIVE_VERSION,
    ...archive,
    workspaceId: normalizedWorkspaceId,
    updatedAt: new Date().toISOString(),
  };
  await store.set(serverArchiveKey(normalizedWorkspaceId), payload);
  await addArchiveWorkspace(store, normalizedWorkspaceId);
  return payload;
}

export async function listArchiveWorkspaces(env = process.env) {
  const store = getArchiveStore(env);
  if (!store) return [];
  const indexed = await store.get(SERVER_ARCHIVE_INDEX_KEY);
  const workspaces = Array.isArray(indexed) ? indexed.filter((value) => typeof value === "string") : [];
  const legacyArchive = await store.get(LEGACY_SERVER_ARCHIVE_KEY);
  if (isObject(legacyArchive) && !workspaces.includes(DEFAULT_WORKSPACE_ID)) workspaces.unshift(DEFAULT_WORKSPACE_ID);
  return [...new Set(workspaces.map(normalizeWorkspaceId))];
}

export function normalizeWorkspaceId(value) {
  const trimmed = String(value || "").trim();
  const normalized = trimmed || DEFAULT_WORKSPACE_ID;
  return normalized.slice(0, 80);
}

export function serverArchiveKey(workspaceId = DEFAULT_WORKSPACE_ID) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const digest = createHash("sha256").update(normalizedWorkspaceId).digest("hex").slice(0, 24);
  return `${SERVER_ARCHIVE_KEY_PREFIX}:${digest}`;
}

async function addArchiveWorkspace(store, workspaceId) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const indexed = await store.get(SERVER_ARCHIVE_INDEX_KEY);
  const workspaces = Array.isArray(indexed) ? indexed.filter((value) => typeof value === "string") : [];
  if (!workspaces.includes(normalizedWorkspaceId)) {
    await store.set(SERVER_ARCHIVE_INDEX_KEY, [...workspaces, normalizedWorkspaceId]);
  }
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
