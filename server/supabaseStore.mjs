import { createHash, randomBytes } from "node:crypto";

const restTimeoutMs = 25_000;
const defaultTenDayTarget = 5000;
const maxScanHistoryRecords = 200;
const maxResultsPerWorkspace = 500;
const addressPattern = /0x[a-fA-F0-9]{40}/g;

export function isSupabaseConfigured(env = process.env) {
  const config = supabaseConfig(env);
  return Boolean(config.url && config.publishableKey && config.secretKey);
}

export function getBearerToken(request) {
  const authorization = headerValue(request.headers, "authorization");
  const direct = headerValue(request.headers, "x-okx-boost-session");
  return authorization.replace(/^Bearer\s+/i, "").trim() || direct.trim();
}

export async function getSupabaseUserFromRequest(request, env = process.env) {
  const token = getBearerToken(request);
  if (!token || !isSupabaseConfigured(env)) return null;
  const user = await getAuthUser(token, env);
  const profile = user?.id ? await getProfileByUserId(env, user.id) : null;
  return user ? { token, user, profile } : null;
}

export async function signInWithPassword(input, env = process.env) {
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || "");
  if (!email) throw userError("请填写邮箱。", 400);
  if (!password) throw userError("请填写密码。", 400);

  const payload = await authFetch(env, "/auth/v1/token?grant_type=password", {
    method: "POST",
    apiKey: "publishable",
    body: { email, password },
  });
  return enrichSessionWithProfile(env, authPayloadToSession(payload));
}

export async function refreshAuthSession(refreshToken, env = process.env) {
  const token = String(refreshToken || "").trim();
  if (!token) throw userError("缺少刷新令牌。", 400);
  const payload = await authFetch(env, "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    apiKey: "publishable",
    body: { refresh_token: token },
  });
  return enrichSessionWithProfile(env, authPayloadToSession(payload));
}

export async function createInvite(input, env = process.env) {
  ensureSupabaseConfigured(env);
  const code = normalizeInviteCode(input?.code) || generateInviteCode();
  const email = normalizeEmail(input?.email);
  const role = input?.role === "admin" ? "admin" : "user";
  const expiresInDays = clampInteger(input?.expiresInDays, 1, 365, 14);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const defaultMaxWallets = role === "admin" ? 200 : 20;
  const defaultRefreshLimit = role === "admin" ? 1000 : 50;
  const defaultRescanLimit = role === "admin" ? 100 : 10;

  const [invite] = await restInsert(env, "invites", [
    {
      code_hash: hashInviteCode(code),
      email: email || null,
      role,
      max_wallets: clampInteger(input?.maxWallets, 1, 500, defaultMaxWallets),
      daily_refresh_limit: clampInteger(input?.dailyRefreshLimit, 0, 5000, defaultRefreshLimit),
      daily_rescan_limit: clampInteger(input?.dailyRescanLimit, 0, 1000, defaultRescanLimit),
      expires_at: expiresAt,
      created_by: isUuid(input?.createdBy) ? input.createdBy : null,
    },
  ]);

  return {
    code,
    invite: redactInvite(invite),
  };
}

export async function listInvites(env = process.env) {
  ensureSupabaseConfigured(env);
  const rows = await restSelect(env, "invites", {
    select: "id,email,role,max_wallets,daily_refresh_limit,daily_rescan_limit,expires_at,used_at,used_by,created_at",
    order: "created_at.desc",
    limit: "50",
  });
  return rows.map(redactInvite);
}

export async function listAdminUsers(env = process.env) {
  ensureSupabaseConfigured(env);
  const profiles = await restSelect(env, "app_profiles", {
    select: "id,email,role,status,max_wallets,daily_refresh_limit,daily_rescan_limit,created_at,updated_at",
    order: "created_at.desc",
    limit: "200",
  });
  const workspaces = await restSelect(env, "workspaces", {
    select: "id,owner_id,updated_at",
    limit: "2000",
  });
  const wallets = await restSelect(env, "wallets", {
    is_active: "eq.true",
    select: "workspace_id,address",
    limit: "10000",
  });
  const stats = userStatsFromWorkspaceRows(workspaces, wallets);
  return profiles.map((profile) => redactAdminUser(profile, stats.get(String(profile.id || ""))));
}

export async function updateAdminUser(input, actorUserId = "", env = process.env) {
  ensureSupabaseConfigured(env);
  const userId = String(input?.userId || input?.profileId || input?.id || "").trim();
  if (!isUuid(userId)) throw userError("用户 ID 无效。", 400);
  const [profile] = await restSelect(env, "app_profiles", {
    id: `eq.${userId}`,
    select: "id,email,role,status,max_wallets,daily_refresh_limit,daily_rescan_limit,created_at,updated_at",
    limit: "1",
  });
  if (!profile) throw userError("用户不存在。", 404);

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input || {}, "status")) {
    const status = input.status === "disabled" ? "disabled" : input.status === "active" ? "active" : "";
    if (!status) throw userError("用户状态无效。", 400);
    if (status === "disabled" && userId === actorUserId) throw userError("不能禁用当前登录的管理员账号。", 400);
    if (status === "disabled" && profile.role === "admin") await assertCanDisableAdmin(env, userId);
    patch.status = status;
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "maxWallets")) {
    patch.max_wallets = clampInteger(input.maxWallets, 1, 500, Number(profile.max_wallets || 20));
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "dailyRefreshLimit")) {
    patch.daily_refresh_limit = clampInteger(input.dailyRefreshLimit, 0, 5000, Number(profile.daily_refresh_limit || 50));
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "dailyRescanLimit")) {
    patch.daily_rescan_limit = clampInteger(input.dailyRescanLimit, 0, 1000, Number(profile.daily_rescan_limit || 10));
  }
  if (!Object.keys(patch).length) throw userError("没有可更新的用户字段。", 400);

  const [updated] = await restPatch(env, "app_profiles", { id: `eq.${userId}` }, patch);
  return redactAdminUser(updated || { ...profile, ...patch });
}

export async function consumeUserUsage(env, user, input) {
  ensureSupabaseConfigured(env);
  const profile = await getActiveProfileForUser(env, user.id);
  const mode = input?.mode === "rescan" ? "rescan" : "refresh";
  const amount = clampInteger(input?.amount, 1, 500, 1);
  const usageDate = utcDateString(new Date());
  const limit = mode === "rescan" ? Number(profile.daily_rescan_limit || 0) : Number(profile.daily_refresh_limit || 0);
  const label = mode === "rescan" ? "强制重扫" : "刷新";
  const countColumn = mode === "rescan" ? "rescan_count" : "refresh_count";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [current] = await restSelect(env, "usage_daily", {
      user_id: `eq.${user.id}`,
      usage_date: `eq.${usageDate}`,
      select: "user_id,usage_date,refresh_count,rescan_count,rpc_request_count,created_at,updated_at",
      limit: "1",
    });
    const refreshCount = Number(current?.refresh_count || 0);
    const rescanCount = Number(current?.rescan_count || 0);
    const currentCount = mode === "rescan" ? rescanCount : refreshCount;

    if (limit > 0 && currentCount + amount > limit) {
      throw userError(`今日${label}额度不足：已用 ${currentCount}，本次 ${amount}，上限 ${limit}。`, 429);
    }

    const nextRefreshCount = mode === "refresh" ? refreshCount + amount : refreshCount;
    const nextRescanCount = mode === "rescan" ? rescanCount + amount : rescanCount;
    const rpcRequestCount = Number(current?.rpc_request_count || 0);

    if (!current) {
      try {
        const [created] = await restInsert(env, "usage_daily", [
          {
            user_id: user.id,
            usage_date: usageDate,
            refresh_count: nextRefreshCount,
            rescan_count: nextRescanCount,
            rpc_request_count: rpcRequestCount,
          },
        ]);
        return redactUsageDaily(created, profile);
      } catch (error) {
        if (isConflictError(error)) continue;
        throw error;
      }
    }

    const usagePatch = {
      rpc_request_count: rpcRequestCount,
    };
    usagePatch[countColumn] = mode === "rescan" ? nextRescanCount : nextRefreshCount;

    const [saved] = await restPatch(env, "usage_daily", {
      user_id: `eq.${user.id}`,
      usage_date: `eq.${usageDate}`,
      [countColumn]: `eq.${currentCount}`,
    }, usagePatch);
    if (saved) return redactUsageDaily(saved, profile);
  }

  throw userError("用量更新冲突，请稍后重试。", 409);
}

export async function revokeInvite(input, env = process.env) {
  ensureSupabaseConfigured(env);
  const inviteId = String(input?.inviteId || input?.id || "").trim();
  if (!isUuid(inviteId)) throw userError("邀请码 ID 无效。", 400);
  const [invite] = await restPatch(
    env,
    "invites",
    { id: `eq.${inviteId}`, used_at: "is.null" },
    { expires_at: new Date().toISOString() },
  );
  if (!invite) throw userError("邀请码不存在或已被使用。", 404);
  return redactInvite(invite);
}

export async function hasActiveAdminProfile(env = process.env) {
  if (!isSupabaseConfigured(env)) return false;
  const rows = await restSelect(env, "app_profiles", {
    role: "eq.admin",
    status: "eq.active",
    select: "id",
    limit: "1",
  });
  return rows.length > 0;
}

export async function isAdminAuth(request, env = process.env) {
  const auth = await getSupabaseUserFromRequest(request, env).catch(() => null);
  const profile = auth?.profile || null;
  return Boolean(profile?.role === "admin" && profile?.status === "active") ? auth : null;
}

export async function redeemInvite(input, env = process.env) {
  ensureSupabaseConfigured(env);
  const code = normalizeInviteCode(input?.inviteCode || input?.code);
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || "");
  if (!code) throw userError("请填写邀请码。", 400);
  if (!email) throw userError("请填写邮箱。", 400);
  if (password.length < 8) throw userError("密码至少 8 位。", 400);

  const [invite] = await restSelect(env, "invites", {
    code_hash: `eq.${hashInviteCode(code)}`,
    select: "*",
    limit: "1",
  });
  validateInvite(invite, email);

  let createdUserId = "";
  try {
    const user = await createAuthUser(env, {
      email,
      password,
      metadata: { invite_id: invite.id },
    });
    createdUserId = user.id;

    await upsertProfile(env, user, invite);
    const workspace = await createDefaultWorkspace(env, user.id, invite);
    await upsertNotificationSettings(env, workspace.id);

    const marked = await restPatch(env, "invites", { id: `eq.${invite.id}`, used_at: "is.null" }, {
      used_at: new Date().toISOString(),
      used_by: user.id,
    });
    if (!marked.length) throw userError("邀请码已被使用，请换一个邀请码。", 409);

    const session = await signInWithPassword({ email, password }, env);
    return {
      session,
      profile: {
        id: user.id,
        email,
        role: invite.role || "user",
        maxWallets: invite.max_wallets,
        dailyRefreshLimit: invite.daily_refresh_limit,
        dailyRescanLimit: invite.daily_rescan_limit,
      },
      workspace: workspaceToClient(workspace),
    };
  } catch (error) {
    if (createdUserId) await deleteAuthUser(env, createdUserId).catch(() => {});
    throw error;
  }
}

export async function getUserArchive(env, user) {
  ensureSupabaseConfigured(env);
  await getActiveProfileForUser(env, user.id);
  const workspace = await getOrCreateDefaultWorkspace(env, user.id);
  const archive = await buildArchiveFromWorkspace(env, workspace);
  return { workspaceId: workspace.id, archive };
}

export async function saveUserArchive(env, user, archive) {
  ensureSupabaseConfigured(env);
  const profile = await getActiveProfileForUser(env, user.id);
  assertWalletQuota(archiveEntries(archive), profile);
  const workspace = await getOrCreateDefaultWorkspace(env, user.id);
  return saveWorkspaceArchive(env, workspace.id, archive);
}

export async function listSupabaseWorkspaceIds(env = process.env) {
  if (!isSupabaseConfigured(env)) return [];
  const profiles = await restSelect(env, "app_profiles", {
    status: "eq.active",
    select: "id",
  });
  const ownerIds = profiles.map((profile) => String(profile.id || "")).filter(Boolean);
  if (!ownerIds.length) return [];
  const rows = await restSelect(env, "workspaces", {
    owner_id: `in.(${ownerIds.join(",")})`,
    select: "id,owner_id",
    order: "created_at.asc",
  });
  return rows.map((row) => String(row.id || "")).filter(Boolean);
}

export async function getSupabaseWorkspaceArchive(env, workspaceId) {
  ensureSupabaseConfigured(env);
  const workspace = await getWorkspaceById(env, workspaceId);
  if (!workspace) return null;
  await getActiveProfileForUser(env, workspace.owner_id);
  const archive = await buildArchiveFromWorkspace(env, workspace);
  return { workspaceId: workspace.id, archive };
}

export async function saveSupabaseWorkspaceArchive(env, workspaceId, archive) {
  ensureSupabaseConfigured(env);
  return saveWorkspaceArchive(env, workspaceId, archive);
}

export async function getUserNotificationSettings(env, user) {
  ensureSupabaseConfigured(env);
  await getActiveProfileForUser(env, user.id);
  const workspace = await getOrCreateDefaultWorkspace(env, user.id);
  const settings = await getOrCreateNotificationSettings(env, workspace.id);
  return redactNotificationSettings(settings);
}

export async function updateUserNotificationSettings(env, user, input) {
  ensureSupabaseConfigured(env);
  await getActiveProfileForUser(env, user.id);
  const workspace = await getOrCreateDefaultWorkspace(env, user.id);
  const current = await getOrCreateNotificationSettings(env, workspace.id);
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(input || {}, "feishuEnabled")) {
    patch.feishu_enabled = Boolean(input.feishuEnabled);
  }

  if (Object.prototype.hasOwnProperty.call(input || {}, "notifyFutureDays")) {
    patch.notify_future_days = clampInteger(input.notifyFutureDays, 0, 30, Number(current.notify_future_days || 3));
  }

  if (input?.clearFeishuWebhook === true) {
    patch.feishu_webhook = "";
    patch.feishu_secret = "";
    patch.feishu_enabled = false;
  } else if (Object.prototype.hasOwnProperty.call(input || {}, "feishuWebhook")) {
    const webhook = String(input.feishuWebhook || "").trim();
    if (webhook) {
      validateFeishuWebhookForStore(webhook);
      patch.feishu_webhook = webhook;
    }
  }

  if (input?.clearFeishuSecret === true) {
    patch.feishu_secret = "";
  } else if (Object.prototype.hasOwnProperty.call(input || {}, "feishuSecret")) {
    const secret = String(input.feishuSecret || "").trim();
    if (secret) {
      if (secret.length > 256) throw userError("飞书签名密钥过长。", 400);
      patch.feishu_secret = secret;
    }
  }

  const nextWebhook = Object.prototype.hasOwnProperty.call(patch, "feishu_webhook") ? patch.feishu_webhook : current.feishu_webhook;
  const nextEnabled = Object.prototype.hasOwnProperty.call(patch, "feishu_enabled")
    ? patch.feishu_enabled
    : Boolean(current.feishu_enabled);
  if (nextEnabled && !String(nextWebhook || "").trim()) throw userError("请先保存飞书机器人 Webhook。", 400);
  if (!Object.keys(patch).length) return redactNotificationSettings(current);

  const [updated] = await restPatch(env, "notification_settings", { workspace_id: `eq.${workspace.id}` }, patch);
  return redactNotificationSettings(updated || { ...current, ...patch });
}

export async function getUserNotificationTarget(env, user) {
  ensureSupabaseConfigured(env);
  await getActiveProfileForUser(env, user.id);
  const workspace = await getOrCreateDefaultWorkspace(env, user.id);
  const settings = await getOrCreateNotificationSettings(env, workspace.id);
  return notificationTargetFromSettings(settings);
}

export async function getSupabaseWorkspaceNotificationTarget(env, workspaceId) {
  ensureSupabaseConfigured(env);
  const workspace = await getWorkspaceById(env, workspaceId);
  if (!workspace) return null;
  const profile = await getActiveProfileForUser(env, workspace.owner_id);
  const settings = await getOrCreateNotificationSettings(env, workspace.id);
  return {
    ...notificationTargetFromSettings(settings),
    workspaceId: workspace.id,
    ownerId: workspace.owner_id,
    ownerEmail: String(profile.email || ""),
  };
}

async function saveWorkspaceArchive(env, workspaceId, archive) {
  const workspace = await getWorkspaceById(env, workspaceId);
  if (!workspace) throw userError("Supabase workspace not found", 404);
  const entries = archiveEntries(archive);
  const profile = await getActiveProfileForUser(env, workspace.owner_id);
  assertWalletQuota(entries, profile);
  const walletRows = await syncWorkspaceWallets(env, workspace.id, entries);
  const walletIdByAddress = new Map(walletRows.map((row) => [normalizeAddress(row.address), row.id]));
  await saveWorkspaceSettings(env, workspace.id, archive);
  await saveScanResults(env, workspace.id, walletIdByAddress, archive);
  const savedWorkspace = await getWorkspaceById(env, workspace.id);
  const savedArchive = await buildArchiveFromWorkspace(env, savedWorkspace || workspace);
  return { workspaceId: workspace.id, archive: savedArchive };
}

async function buildArchiveFromWorkspace(env, workspace) {
  const settings = isObject(workspace.settings) ? workspace.settings : {};
  const wallets = await restSelect(env, "wallets", {
    workspace_id: `eq.${workspace.id}`,
    is_active: "eq.true",
    select: "id,address,name,sort_order,created_at,updated_at",
    order: "sort_order.asc,created_at.asc",
  });
  const results = await restSelect(env, "wallet_scan_results", {
    workspace_id: `eq.${workspace.id}`,
    select: "wallet_address,snapshot_date,result,source,saved_at",
    order: "snapshot_date.desc,saved_at.desc",
    limit: String(maxResultsPerWorkspace),
  });

  const preferredDate = isUtcDate(settings.endDate) ? settings.endDate : "";
  const resultsByAddress = groupResultsByAddress(results);
  const records = wallets.map((wallet) => {
    const address = normalizeAddress(wallet.address);
    const walletResults = resultsByAddress.get(address) || [];
    const exact = preferredDate ? walletResults.find((row) => row.snapshot_date === preferredDate) : null;
    const latest = exact || walletResults[0] || null;
    const result = isObject(latest?.result) ? latest.result : null;
    return {
      address,
      name: String(wallet.name || ""),
      state: result ? "done" : "idle",
      source: result ? "archive" : "empty",
      result,
      progress: result ? "已从 Supabase 云端归档恢复" : "等待扫描",
      error: "",
      savedAt: typeof latest?.saved_at === "string" ? latest.saved_at : undefined,
    };
  });

  const walletsText = wallets.length
    ? wallets.map((wallet) => walletLine(wallet.name, wallet.address)).join("\n")
    : String(settings.walletsText || "");

  return {
    workspaceId: workspace.id,
    updatedAt: typeof workspace.updated_at === "string" ? workspace.updated_at : undefined,
    walletsText,
    endDate: preferredDate,
    tenDayTarget: String(workspace.ten_day_target || defaultTenDayTarget),
    boostOverrides: String(settings.boostOverrides || ""),
    records,
    scanHistory: Array.isArray(settings.scanHistory) ? settings.scanHistory.slice(0, maxScanHistoryRecords) : [],
    cron: isObject(settings.cron) ? settings.cron : {},
  };
}

async function syncWorkspaceWallets(env, workspaceId, entries) {
  const activeAddresses = new Set(entries.map((entry) => entry.address));
  const existing = await restSelect(env, "wallets", {
    workspace_id: `eq.${workspaceId}`,
    select: "id,address,is_active",
  });

  await Promise.all(
    existing
      .filter((row) => !activeAddresses.has(normalizeAddress(row.address)) && row.is_active)
      .map((row) => restPatch(env, "wallets", { id: `eq.${row.id}` }, { is_active: false })),
  );

  if (!entries.length) return [];
  return restUpsert(
    env,
    "wallets",
    entries.map((entry, index) => ({
      workspace_id: workspaceId,
      address: entry.address,
      name: entry.name,
      sort_order: index,
      is_active: true,
    })),
    "workspace_id,address",
  );
}

async function saveWorkspaceSettings(env, workspaceId, archive) {
  const tenDayTarget = parsePositiveNumber(archive.tenDayTarget) || defaultTenDayTarget;
  const settings = {
    walletsText: String(archive.walletsText || ""),
    endDate: isUtcDate(archive.endDate) ? archive.endDate : "",
    boostOverrides: String(archive.boostOverrides || ""),
    scanHistory: Array.isArray(archive.scanHistory) ? archive.scanHistory.slice(0, maxScanHistoryRecords) : [],
    cron: isObject(archive.cron) ? archive.cron : {},
    updatedFrom: "archive-api",
  };
  await restPatch(env, "workspaces", { id: `eq.${workspaceId}` }, { ten_day_target: tenDayTarget, settings });
}

async function saveScanResults(env, workspaceId, walletIdByAddress, archive) {
  const rows = (Array.isArray(archive.records) ? archive.records : [])
    .filter((record) => isObject(record?.result))
    .map((record) => {
      const result = record.result;
      const address = normalizeAddress(record.address);
      const countedSwaps = Array.isArray(result.swaps) ? result.swaps.filter((swap) => swap.status === "counted") : [];
      return {
        workspace_id: workspaceId,
        wallet_id: walletIdByAddress.get(address) || null,
        wallet_address: address,
        snapshot_date: isUtcDate(result.windowEnd) ? result.windowEnd : archive.endDate,
        window_start: result.windowStart,
        window_end: result.windowEnd,
        boost_volume: Number(result.totalBoostVolume || 0),
        raw_volume: Number(result.totalTradeUsd || 0),
        tx_count: countedSwaps.length,
        result,
        source: record.source || result.txDiscoverySource || "server",
        saved_at: record.savedAt || new Date().toISOString(),
      };
    })
    .filter((row) => isUtcDate(row.snapshot_date) && isUtcDate(row.window_start) && isUtcDate(row.window_end));

  if (!rows.length) return [];
  return restUpsert(env, "wallet_scan_results", rows, "workspace_id,wallet_address,snapshot_date");
}

async function getOrCreateDefaultWorkspace(env, userId) {
  const [existing] = await restSelect(env, "workspaces", {
    owner_id: `eq.${userId}`,
    select: "id,owner_id,name,ten_day_target,settings,created_at,updated_at",
    order: "created_at.asc",
    limit: "1",
  });
  if (existing) return existing;
  const workspace = await createDefaultWorkspace(env, userId, {});
  await upsertNotificationSettings(env, workspace.id);
  return workspace;
}

async function getWorkspaceById(env, workspaceId) {
  const [workspace] = await restSelect(env, "workspaces", {
    id: `eq.${workspaceId}`,
    select: "id,owner_id,name,ten_day_target,settings,created_at,updated_at",
    limit: "1",
  });
  return workspace || null;
}

async function createDefaultWorkspace(env, userId, invite) {
  const [workspace] = await restInsert(env, "workspaces", [
    {
      owner_id: userId,
      name: "默认工作区",
      ten_day_target: defaultTenDayTarget,
      settings: {
        source: "invite",
        inviteId: invite?.id || null,
      },
    },
  ]);
  return workspace;
}

async function upsertProfile(env, user, invite) {
  await restUpsert(env, "app_profiles", [
    {
      id: user.id,
      email: normalizeEmail(user.email),
      role: invite.role || "user",
      status: "active",
      max_wallets: invite.max_wallets || 20,
      daily_refresh_limit: invite.daily_refresh_limit || 50,
      daily_rescan_limit: invite.daily_rescan_limit || 10,
    },
  ], "id");
}

async function upsertNotificationSettings(env, workspaceId) {
  await restUpsert(env, "notification_settings", [
    {
      workspace_id: workspaceId,
      feishu_enabled: false,
      notify_future_days: 3,
    },
  ], "workspace_id");
}

async function getOrCreateNotificationSettings(env, workspaceId) {
  const [existing] = await restSelect(env, "notification_settings", {
    workspace_id: `eq.${workspaceId}`,
    select: "workspace_id,feishu_webhook,feishu_secret,feishu_enabled,notify_future_days,created_at,updated_at",
    limit: "1",
  });
  if (existing) return existing;
  const [created] = await restUpsert(env, "notification_settings", [
    {
      workspace_id: workspaceId,
      feishu_enabled: false,
      notify_future_days: 3,
    },
  ], "workspace_id");
  return created;
}

async function getProfileByUserId(env, userId) {
  const [profile] = await restSelect(env, "app_profiles", {
    id: `eq.${userId}`,
    select: "id,email,role,status,max_wallets,daily_refresh_limit,daily_rescan_limit,created_at,updated_at",
    limit: "1",
  });
  return profile || null;
}

async function getActiveProfileForUser(env, userId) {
  const profile = await getProfileByUserId(env, userId);
  if (!profile) throw userError("账号资料不存在，请重新注册或联系管理员。", 403);
  if (profile.status !== "active") throw userError("账号已被禁用。", 403);
  return profile;
}

function assertWalletQuota(entries, profile) {
  const maxWallets = Number(profile?.max_wallets || 0);
  if (maxWallets > 0 && entries.length > maxWallets) {
    throw userError(`钱包数量超过账号上限：当前 ${entries.length} 个，上限 ${maxWallets} 个。`, 403);
  }
}

async function assertCanDisableAdmin(env, userId) {
  const activeAdmins = await restSelect(env, "app_profiles", {
    role: "eq.admin",
    status: "eq.active",
    select: "id",
    limit: "20",
  });
  const remainingAdmins = activeAdmins.filter((profile) => String(profile.id || "") !== userId);
  if (!remainingAdmins.length) throw userError("不能禁用最后一个 active 管理员账号。", 400);
}

async function getAuthUser(token, env) {
  const user = await authFetch(env, "/auth/v1/user", {
    method: "GET",
    apiKey: "publishable",
    bearerToken: token,
  });
  if (!user?.id) throw userError("登录已过期，请重新登录。", 401);
  return user;
}

async function createAuthUser(env, params) {
  const payload = await authFetch(env, "/auth/v1/admin/users", {
    method: "POST",
    apiKey: "secret",
    bearerToken: supabaseConfig(env).secretKey,
    body: {
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: params.metadata || {},
    },
  });
  if (!payload?.id) throw new Error("Supabase did not return created user id");
  return payload;
}

async function deleteAuthUser(env, userId) {
  return authFetch(env, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    apiKey: "secret",
    bearerToken: supabaseConfig(env).secretKey,
  });
}

async function restSelect(env, table, query) {
  const url = supabaseUrl(env, `/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  return supabaseFetch(env, url, { method: "GET" });
}

async function restInsert(env, table, body) {
  return supabaseFetch(env, supabaseUrl(env, `/rest/v1/${table}`), {
    method: "POST",
    body,
    prefer: "return=representation",
  });
}

async function restUpsert(env, table, body, onConflict) {
  const url = supabaseUrl(env, `/rest/v1/${table}`);
  url.searchParams.set("on_conflict", onConflict);
  return supabaseFetch(env, url, {
    method: "POST",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

async function restPatch(env, table, query, body) {
  const url = supabaseUrl(env, `/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  return supabaseFetch(env, url, {
    method: "PATCH",
    body,
    prefer: "return=representation",
  });
}

async function authFetch(env, path, options) {
  ensureSupabaseConfigured(env);
  const config = supabaseConfig(env);
  const apiKey = options.apiKey === "secret" ? config.secretKey : config.publishableKey;
  return fetchJson(supabaseUrl(env, path), {
    method: options.method,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${options.bearerToken || apiKey}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function supabaseFetch(env, url, options) {
  ensureSupabaseConfigured(env);
  const secretKey = supabaseConfig(env).secretKey;
  return fetchJson(url, {
    method: options.method,
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), restTimeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const payload = text ? parseJson(text) : null;
    if (!response.ok) {
      const message =
        payload?.msg ||
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `Supabase HTTP ${response.status}`;
      throw userError(message, response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${restTimeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function authPayloadToSession(payload) {
  if (!payload?.access_token || !payload?.refresh_token || !payload?.user?.id) {
    throw new Error("Supabase auth response is incomplete");
  }
  const expiresIn = Number(payload.expires_in || 3600);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    user: {
      id: payload.user.id,
      email: payload.user.email || "",
    },
  };
}

async function enrichSessionWithProfile(env, session) {
  const profile = await getProfileByUserId(env, session.user.id);
  if (!profile) throw userError("账号资料不存在，请重新注册或联系管理员。", 403);
  if (profile.status !== "active") throw userError("账号已被禁用。", 403);
  return {
    ...session,
    user: {
      ...session.user,
      role: profile?.role || "user",
      status: profile?.status || "active",
      maxWallets: Number(profile?.max_wallets || 0),
      dailyRefreshLimit: Number(profile?.daily_refresh_limit || 0),
      dailyRescanLimit: Number(profile?.daily_rescan_limit || 0),
    },
  };
}

function validateInvite(invite, email) {
  if (!invite) throw userError("邀请码不存在。", 404);
  if (invite.used_at || invite.used_by) throw userError("邀请码已被使用。", 409);
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw userError("邀请码已过期。", 410);
  }
  const inviteEmail = normalizeEmail(invite.email);
  if (inviteEmail && inviteEmail !== email) {
    throw userError("邀请码绑定的邮箱与当前邮箱不一致。", 403);
  }
}

function archiveEntries(archive) {
  const parsed = parseWalletEntries(String(archive.walletsText || ""));
  const byAddress = new Map(parsed.map((entry) => [entry.address, entry]));
  for (const record of Array.isArray(archive.records) ? archive.records : []) {
    if (!isAddress(record?.address)) continue;
    const address = normalizeAddress(record.address);
    const existing = byAddress.get(address);
    byAddress.set(address, {
      address,
      name: existing?.name || cleanWalletName(record.name || ""),
    });
  }
  return [...byAddress.values()];
}

function parseWalletEntries(raw) {
  const seen = new Set();
  const entries = [];
  for (const rawLine of raw.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const match of line.matchAll(addressPattern)) {
      const address = normalizeAddress(match[0]);
      if (seen.has(address)) continue;
      seen.add(address);
      entries.push({
        address,
        name: cleanWalletName(line.replace(addressPattern, " ")),
      });
    }
  }
  return entries;
}

function groupResultsByAddress(results) {
  const grouped = new Map();
  for (const row of results) {
    if (!isAddress(row.wallet_address)) continue;
    const address = normalizeAddress(row.wallet_address);
    const rows = grouped.get(address) || [];
    rows.push(row);
    grouped.set(address, rows);
  }
  return grouped;
}

function supabaseConfig(env) {
  return {
    url: envValue(env, "SUPABASE_URL"),
    publishableKey: envValue(env, "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: envValue(env, "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function ensureSupabaseConfigured(env) {
  if (!isSupabaseConfigured(env)) {
    throw userError("Supabase is not configured", 503);
  }
}

function supabaseUrl(env, path) {
  const base = supabaseConfig(env).url.replace(/\/+$/, "");
  return new URL(path, `${base}/`);
}

function envValue(env, primary, legacy) {
  return String(env[primary] || (legacy ? env[legacy] || "" : "") || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeInviteCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function hashInviteCode(code) {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

function generateInviteCode() {
  return `OKX-${randomBytes(9).toString("base64url").toUpperCase()}`;
}

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function isConflictError(error) {
  return (
    Number(error?.statusCode || 0) === 409 ||
    /duplicate key|unique constraint|already exists/i.test(String(error?.message || ""))
  );
}

function redactInvite(invite) {
  if (!invite) return null;
  return {
    id: String(invite.id || ""),
    email: invite.email || "",
    role: invite.role || "user",
    maxWallets: Number(invite.max_wallets || 0),
    dailyRefreshLimit: Number(invite.daily_refresh_limit || 0),
    dailyRescanLimit: Number(invite.daily_rescan_limit || 0),
    expiresAt: invite.expires_at || "",
    usedAt: invite.used_at || "",
    usedBy: invite.used_by || "",
    createdAt: invite.created_at || "",
  };
}

function redactAdminUser(profile, stats = {}) {
  if (!profile) return null;
  return {
    id: String(profile.id || ""),
    email: String(profile.email || ""),
    role: profile.role === "admin" ? "admin" : "user",
    status: profile.status === "disabled" ? "disabled" : "active",
    maxWallets: Number(profile.max_wallets || 0),
    dailyRefreshLimit: Number(profile.daily_refresh_limit || 0),
    dailyRescanLimit: Number(profile.daily_rescan_limit || 0),
    workspaceCount: Number(stats.workspaceCount || 0),
    walletCount: Number(stats.walletCount || 0),
    createdAt: profile.created_at || "",
    updatedAt: profile.updated_at || "",
  };
}

function redactUsageDaily(usage, profile) {
  return {
    usageDate: String(usage?.usage_date || ""),
    refreshCount: Number(usage?.refresh_count || 0),
    rescanCount: Number(usage?.rescan_count || 0),
    rpcRequestCount: Number(usage?.rpc_request_count || 0),
    dailyRefreshLimit: Number(profile?.daily_refresh_limit || 0),
    dailyRescanLimit: Number(profile?.daily_rescan_limit || 0),
  };
}

function redactNotificationSettings(settings) {
  const webhook = String(settings?.feishu_webhook || "").trim();
  const secret = String(settings?.feishu_secret || "").trim();
  return {
    feishuEnabled: Boolean(settings?.feishu_enabled),
    feishuConfigured: Boolean(webhook),
    feishuWebhookMasked: maskWebhookUrl(webhook),
    feishuSecretConfigured: Boolean(secret),
    notifyFutureDays: clampInteger(settings?.notify_future_days, 0, 30, 3),
    updatedAt: settings?.updated_at || "",
  };
}

function notificationTargetFromSettings(settings) {
  const webhookUrl = String(settings?.feishu_webhook || "").trim();
  return {
    enabled: Boolean(settings?.feishu_enabled) && Boolean(webhookUrl),
    webhookUrl,
    webhookSecret: String(settings?.feishu_secret || "").trim(),
    notifyFutureDays: clampInteger(settings?.notify_future_days, 0, 30, 3),
  };
}

function maskWebhookUrl(webhook) {
  if (!webhook) return "";
  try {
    const url = new URL(webhook);
    const token = url.pathname.split("/").filter(Boolean).pop() || "";
    const suffix = token.length > 8 ? token.slice(-8) : token;
    return `${url.hostname}/.../${suffix || "已保存"}`;
  } catch {
    return "已保存";
  }
}

function validateFeishuWebhookForStore(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw userError("飞书机器人 Webhook 格式无效。", 400);
  }
  const allowedHosts = new Set(["open.feishu.cn", "open.larksuite.com"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || !url.pathname.startsWith("/open-apis/bot/v2/hook/")) {
    throw userError("只支持飞书或 Lark 自定义机器人 Webhook。", 400);
  }
}

function userStatsFromWorkspaceRows(workspaces, wallets) {
  const ownerByWorkspace = new Map();
  const stats = new Map();
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    const ownerId = String(workspace.owner_id || "");
    const workspaceId = String(workspace.id || "");
    if (!ownerId || !workspaceId) continue;
    ownerByWorkspace.set(workspaceId, ownerId);
    const current = stats.get(ownerId) || { workspaceCount: 0, walletCount: 0 };
    current.workspaceCount += 1;
    stats.set(ownerId, current);
  }
  const seenWallets = new Set();
  for (const wallet of Array.isArray(wallets) ? wallets : []) {
    const workspaceId = String(wallet.workspace_id || "");
    const ownerId = ownerByWorkspace.get(workspaceId);
    const address = normalizeAddress(wallet.address || "");
    if (!ownerId || !address) continue;
    const key = `${ownerId}:${address}`;
    if (seenWallets.has(key)) continue;
    seenWallets.add(key);
    const current = stats.get(ownerId) || { workspaceCount: 0, walletCount: 0 };
    current.walletCount += 1;
    stats.set(ownerId, current);
  }
  return stats;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function workspaceToClient(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    tenDayTarget: workspace.ten_day_target,
  };
}

function walletLine(name, address) {
  const cleanName = cleanWalletName(name || "");
  const normalizedAddress = normalizeAddress(address);
  return cleanName ? `${cleanName} ${normalizedAddress}` : normalizedAddress;
}

function cleanWalletName(raw) {
  return String(raw || "").replace(/[=：:|,，;；]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function parsePositiveNumber(value) {
  const parsed = Number(String(value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function isUtcDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function userError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[name.toLowerCase()] || headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}
