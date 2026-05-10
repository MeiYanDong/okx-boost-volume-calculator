import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  ExternalLink,
  Gauge,
  Home,
  LockKeyhole,
  LogIn,
  LogOut,
  MoreHorizontal,
  PencilLine,
  RefreshCcw,
  Send,
  Settings,
  ShieldCheck,
  UserCircle,
  Wallet,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BSC_CHAIN, isAddress, normalizeAddress } from "./lib/chains";
import { buildUtcWindow, calculateBoostVolume, latestSelectableUtcDate } from "./lib/calculator";
import { formatNumber, formatUsd, shortHash } from "./lib/format";
import { readServerAccessPassword, serverAccessHeaders, writeServerAccessPassword } from "./lib/serverAccess";
import {
  authHeaders,
  createAdminInvite,
  getNotificationSettings,
  listAdminUsers,
  listAdminInvites,
  readAuthSession,
  redeemInvite,
  refreshAuthProfile,
  refreshAuthSession,
  revokeAdminInvite,
  shouldRefreshSession,
  signInWithEmail,
  updateAdminUser,
  updateNotificationSettings,
  validateAuthSession,
  writeAuthSession,
  type AdminInvite,
  type AdminUserProfile,
  type AuthMode,
  type AuthSession,
  type NotificationSettings,
} from "./lib/auth";
import type { CalculationResult, ParsedSwap, TokenGroup, TokenMeta } from "./lib/types";

const SAMPLE_WALLET = "";
const LEGACY_SAMPLE_WALLET = "0x35217ad88c31db4c95e67b77e68795ea4d54cc30";
const SERVER_MANAGED_EXPLORER_API_KEY = "__server__";
const SERVER_MANAGED_ANKR_RPC_URL = "/api/ankr";
const ACCESS_HEADER = "x-okx-boost-access";
const WORKSPACE_HEADER = "x-okx-boost-workspace";
const DEFAULT_DATA_SPACE = "default";
const UI_STATE_KEY = "okx-boost:ui:v4";
const RESULT_CACHE_PREFIX = "okx-boost:result:v2";
const SCAN_HISTORY_KEY = "okx-boost:scan-history:v1";
const BULK_SCAN_CONCURRENCY = 3;
const DEFAULT_TEN_DAY_TARGET = "5000";
const MAX_SCAN_HISTORY_RECORDS = 200;
const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/g;
const SNAPSHOT_CONFIRM_TIME_LABEL = "08:00";

type RunState = "idle" | "running" | "done" | "error";
type ArchiveSource = "empty" | "archive" | "fresh";
type WalletFilter = "all" | "archived" | "running" | "pending" | "error";
type AppView = "overview" | "wallets" | "scan-records" | "reports" | "settings";
type DetailTab = "daily" | "bonus" | "tx";
type ScanMode = "scan" | "refresh" | "rescan" | "archive";
type ScanHistoryStatus = "success" | "error";
type PrimaryActionKind = "manage-wallets" | "running" | "scan-pending" | "retry-failed" | "refresh-all";
type PrimaryActionModel = {
  kind: PrimaryActionKind;
  label: string;
  description: string;
  disabled?: boolean;
};
type NotifyState = {
  status: "idle" | "sending" | "sent" | "error";
  message: string;
};
type ArchiveSyncState = {
  status: "idle" | "loading" | "saving" | "synced" | "error";
  message: string;
};
type AuthRequestState = {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
};
type InviteAdminState = {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  code?: string;
};
type ScopedBonusRules = {
  scoped: Record<string, number>;
  global: Record<string, number>;
};
type PersistedUiState = {
  address?: string;
  walletsText?: string;
  endDate?: string;
  boostOverrides?: string;
  selectedWallet?: string;
  tenDayTarget?: string;
  dataSpace?: string;
  walletFilter?: WalletFilter;
  currentView?: AppView;
};
type PersistedResultRecord = {
  result: CalculationResult;
  savedAt?: string;
};
type ServerArchivePayload = {
  workspaceId?: string;
  updatedAt?: string;
  walletsText?: string;
  endDate?: string;
  tenDayTarget?: string;
  boostOverrides?: string;
  records?: WalletArchiveRecord[];
  scanHistory?: ScanHistoryRecord[];
};
type WalletListEntry = {
  address: string;
  name: string;
};
type ParsedWalletList = {
  entries: WalletListEntry[];
  addresses: string[];
  invalid: string[];
  duplicateCount: number;
};
type WalletArchiveRecord = {
  address: string;
  name: string;
  state: RunState;
  source: ArchiveSource;
  result: CalculationResult | null;
  progress: string;
  error: string;
  savedAt?: string;
};
type ScanWalletOptions = {
  forceRefresh?: boolean;
  refresh?: boolean;
};
type ScanHistoryRecord = {
  id: string;
  address: string;
  snapshotDate: string;
  mode: ScanMode;
  status: ScanHistoryStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  source?: CalculationResult["txDiscoverySource"];
  scannedFromBlock?: number;
  scannedToBlock?: number;
  incrementalFromBlock?: number;
  newTxCount?: number;
  totalTxCount?: number;
  warningCount?: number;
  error?: string;
};
type DailyPortfolioRow = {
  date: string;
  boostVolume: number;
  tradeUsd: number;
  txCount: number;
};
type WalletRankingRow = {
  address: string;
  name: string;
  totalBoostVolume: number;
  averageBoostVolume: number;
  todayBoostVolume: number;
  countedTxCount: number;
  targetDelta: number | null;
};
type SourceBreakdownRow = {
  source: CalculationResult["txDiscoverySource"];
  label: string;
  walletCount: number;
  boostVolume: number;
};
type PortfolioSummary = {
  totalWallets: number;
  archivedWallets: number;
  runningWallets: number;
  pendingWallets: number;
  failedWallets: number;
  averageBoostVolume: number;
  totalBoostVolume: number;
  todayBoostVolume: number;
  countedTxCount: number;
  targetGap: number;
  targetRate: number;
};
type SnapshotForecastWalletRow = {
  address: string;
  name: string;
  boostVolume: number;
  gap: number;
  expiredBoostVolume: number;
  targetMet: boolean;
};
type SnapshotForecastRow = {
  snapshotDate: string;
  runLabel: string;
  windowStart: string;
  windowEnd: string;
  expiredDate: string;
  archivedWallets: number;
  targetMetWallets: number;
  atRiskWallets: number;
  totalBoostVolume: number;
  expiredBoostVolume: number;
  worstGap: number;
  walletRows: SnapshotForecastWalletRow[];
};

export default function App() {
  const maxSnapshotDate = latestSelectableUtcDate();
  const [initialUiState] = useState(readPersistedUiState);
  const initialWalletsText = initialUiState.walletsText || initialUiState.address || SAMPLE_WALLET;
  const initialEndDate = initialUiState.endDate || maxSnapshotDate;
  const hasPersistedWalletState = Boolean(initialUiState.walletsText || initialUiState.address);
  const [walletsText, setWalletsText] = useState(initialWalletsText);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [tenDayTarget, setTenDayTarget] = useState(initialUiState.tenDayTarget || DEFAULT_TEN_DAY_TARGET);
  const [dataSpace, setDataSpace] = useState(normalizeDataSpace(initialUiState.dataSpace || DEFAULT_DATA_SPACE));
  const [accessPassword, setAccessPassword] = useState(readServerAccessPassword);
  const [authSession, setAuthSession] = useState<AuthSession | null>(readAuthSession);
  const [authState, setAuthState] = useState<AuthRequestState>({ status: "idle", message: "" });
  const [boostOverrides, setBoostOverrides] = useState(initialUiState.boostOverrides || "");
  const [selectedWallet, setSelectedWallet] = useState("");
  const [walletFilter, setWalletFilter] = useState<WalletFilter>(initialUiState.walletFilter || "all");
  const [currentView, setCurrentView] = useState<AppView>(
    isAppView(initialUiState.currentView) ? initialUiState.currentView : "overview",
  );
  const [notifyState, setNotifyState] = useState<NotifyState>({ status: "idle", message: "" });
  const [archiveSyncState, setArchiveSyncState] = useState<ArchiveSyncState>({ status: "idle", message: "服务端归档待同步" });
  const [serverArchiveReady, setServerArchiveReady] = useState(false);
  const [serverArchiveContext, setServerArchiveContext] = useState("");
  const [records, setRecords] = useState<WalletArchiveRecord[]>(() =>
    syncWalletRecords([], parseWalletList(initialWalletsText).entries, initialEndDate),
  );
  const [scanHistory, setScanHistory] = useState<ScanHistoryRecord[]>(readPersistedScanHistory);

  const parsedWallets = useMemo(() => parseWalletList(walletsText), [walletsText]);
  const walletsKey = parsedWallets.addresses.join(",");
  const walletNamesKey = parsedWallets.entries.map((entry) => `${entry.address}:${entry.name}`).join("|");
  const walletNameByAddress = useMemo(
    () => new Map(parsedWallets.entries.map((entry) => [entry.address, entry.name])),
    [walletNamesKey, parsedWallets.entries],
  );
  const anyRunning = records.some((record) => record.state === "running");
  const appliedRecords = useMemo(
    () =>
      records.map((record) => ({
        ...record,
        result: record.result ? applyBonusRules(record.result, boostOverrides, record.address) : null,
      })),
    [records, boostOverrides],
  );
  const filteredRecords = useMemo(
    () => filterWalletRecords(appliedRecords, walletFilter),
    [appliedRecords, walletFilter],
  );
  const targetTotal = parseOptionalAmount(tenDayTarget);
  const portfolio = useMemo(
    () => buildPortfolioSummary(appliedRecords, endDate, targetTotal),
    [appliedRecords, endDate, targetTotal],
  );
  const snapshotForecastRows = useMemo(
    () => buildSnapshotForecastRows(appliedRecords, endDate, targetTotal),
    [appliedRecords, endDate, targetTotal],
  );
  const scanHistoryRows = useMemo(
    () => (scanHistory.length > 0 ? scanHistory : buildArchiveHistoryRecords(appliedRecords, endDate)),
    [scanHistory, appliedRecords, endDate],
  );
  const selectedRecord = appliedRecords.find((record) => record.address === selectedWallet) || null;
  const viewMeta = viewMetaFor(currentView, targetTotal);
  const canUseServerArchive = Boolean(authSession || accessPassword.trim());
  const archiveContextKey = authSession ? `auth:${authSession.user.id}` : canUseServerArchive ? `workspace:${dataSpace}` : "local";
  const authMaxWallets = Number(authSession?.user.maxWallets || 0);
  const authWalletQuotaExceeded = Boolean(authSession && authMaxWallets > 0 && parsedWallets.entries.length > authMaxWallets);
  const primaryAction = useMemo(
    () => buildPrimaryAction(appliedRecords, portfolio, anyRunning),
    [appliedRecords, portfolio, anyRunning],
  );

  useEffect(() => {
    if (authSession) return;
    writePersistedUiState({
      walletsText,
      endDate,
      boostOverrides,
      tenDayTarget,
      dataSpace,
      walletFilter,
      currentView,
    });
  }, [authSession, walletsText, endDate, boostOverrides, tenDayTarget, dataSpace, walletFilter, currentView]);

  useEffect(() => {
    writeServerAccessPassword(accessPassword);
  }, [accessPassword]);

  useEffect(() => {
    writeAuthSession(authSession);
  }, [authSession]);

  useEffect(() => {
    if (!authSession) return;
    let cancelled = false;

    async function refreshIfNeeded() {
      if (!authSession || !shouldRefreshSession(authSession)) return;
      try {
        const nextSession = await refreshAuthSession(authSession.refreshToken);
        if (!cancelled) {
          setAuthSession(nextSession);
          setAuthState({ status: "ready", message: "已刷新 Supabase 登录态" });
        }
      } catch {
        if (!cancelled) {
          setAuthSession(null);
          setAuthState({ status: "error", message: "登录已过期，请重新登录" });
        }
      }
    }

    void refreshIfNeeded();
    const interval = window.setInterval(() => void refreshIfNeeded(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authSession?.accessToken, authSession?.refreshToken, authSession?.expiresAt]);

  useEffect(() => {
    const session = readAuthSession();
    if (!session) return;
    const storedSession = session;
    let cancelled = false;
    async function restoreSession() {
      try {
        const nextSession = shouldRefreshSession(storedSession)
          ? await refreshAuthSession(storedSession.refreshToken)
          : storedSession;
        const profiledSession = shouldRefreshSession(storedSession)
          ? nextSession
          : await refreshAuthProfile(nextSession);
        const valid = profiledSession ? true : await validateAuthSession(nextSession);
        if (!valid || !profiledSession) throw new Error("登录状态已失效。");
        if (!cancelled) {
          setAuthSession(profiledSession);
          setAuthState({ status: "ready", message: "已连接 Supabase 云端归档" });
        }
      } catch {
        if (!cancelled) {
          setAuthSession(null);
          setAuthState({ status: "error", message: "登录已过期，请重新登录" });
        }
      }
    }
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRecords((current) => syncWalletRecords(current, parsedWallets.entries, endDate));
  }, [walletsKey, walletNamesKey, endDate, parsedWallets.entries]);

  useEffect(() => {
    let cancelled = false;
    const contextKey = archiveContextKey;
    async function loadServerArchive() {
      if (!canUseServerArchive) {
        setArchiveSyncState({ status: "idle", message: "登录或填写私有访问码后同步云端归档" });
        setServerArchiveContext(contextKey);
        setServerArchiveReady(true);
        return;
      }
      setServerArchiveReady(false);
      setServerArchiveContext("");
      setArchiveSyncState({ status: "loading", message: "正在读取服务端归档..." });
      try {
        const response = await fetch("/api/archive", {
          method: "GET",
          headers: archiveAccessHeaders(accessPassword, dataSpace, {}, authSession),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `服务端归档读取失败 HTTP ${response.status}`);
        }
        const payload = (await response.json().catch(() => ({}))) as { archive?: ServerArchivePayload | null };
        const archive = payload.archive;
        if (!archive || (!archive.walletsText && !archive.records?.length)) {
          if (authSession) {
            resetSupabaseArchiveView();
            setArchiveSyncState({ status: "synced", message: "当前账号云端暂无归档，请先添加钱包" });
          } else {
            setArchiveSyncState({ status: "synced", message: `数据空间 ${dataSpace} 暂无服务端归档` });
          }
          return;
        }
        if (cancelled) return;
        hydrateServerArchive(archive);
        setArchiveSyncState({ status: "synced", message: authSession ? "已恢复 Supabase 云端归档" : `已恢复数据空间 ${dataSpace}` });
      } catch {
        const message = authSession ? "云端归档未同步，请重新登录或稍后重试" : "服务端归档未同步，请检查私有访问码或稍后重试";
        setArchiveSyncState({ status: "error", message });
      } finally {
        if (!cancelled) {
          setServerArchiveContext(contextKey);
          setServerArchiveReady(true);
        }
      }
    }
    void loadServerArchive();
    return () => {
      cancelled = true;
    };
  }, [accessPassword, dataSpace, authSession?.accessToken, authSession?.user.id, canUseServerArchive, archiveContextKey]);

  useEffect(() => {
    if (!serverArchiveReady || serverArchiveContext !== archiveContextKey || anyRunning) return;
    if (!canUseServerArchive) {
      setArchiveSyncState({ status: "idle", message: "登录或填写私有访问码后同步云端归档" });
      return;
    }
    if (shouldSkipServerArchiveSync(walletsText, records, scanHistory)) {
      setArchiveSyncState({ status: "idle", message: "添加钱包或完成扫描后同步服务端归档" });
      return;
    }
    if (authWalletQuotaExceeded) {
      setArchiveSyncState({
        status: "error",
        message: `钱包数量超过账号上限：当前 ${parsedWallets.entries.length} 个，上限 ${authMaxWallets} 个。`,
      });
      return;
    }
    const timer = window.setTimeout(() => {
      setArchiveSyncState({ status: "saving", message: "正在同步服务端归档..." });
      void syncServerArchive({
        walletsText,
        endDate,
        tenDayTarget,
        boostOverrides,
        dataSpace,
        records,
        scanHistory,
        accessPassword,
        authSession,
      }).then((result) => {
        setArchiveSyncState(
          result.ok
            ? { status: "synced", message: authSession ? "已同步到 Supabase 云端" : `已同步到数据空间 ${dataSpace}` }
            : { status: "error", message: result.error || "服务端归档同步失败" },
        );
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [serverArchiveReady, serverArchiveContext, archiveContextKey, anyRunning, walletsText, endDate, tenDayTarget, boostOverrides, dataSpace, records, scanHistory, accessPassword, authSession, canUseServerArchive, authWalletQuotaExceeded, authMaxWallets, parsedWallets.entries.length]);

  useEffect(() => {
    if (selectedWallet && !parsedWallets.addresses.includes(selectedWallet)) {
      setSelectedWallet("");
    }
  }, [selectedWallet, walletsKey, parsedWallets.addresses]);

  async function runWalletBatch(params: {
    addresses: string[];
    forceRefresh?: boolean;
    refresh?: boolean;
  }) {
    const addresses = params.addresses;
    if (!addresses.length) {
      return;
    }

    if (params.forceRefresh) {
      for (const wallet of addresses) clearPersistedResult(wallet, endDate);
    }

    const concurrency = Math.min(BULK_SCAN_CONCURRENCY, addresses.length);

    await runWithConcurrency(addresses, concurrency, async (wallet) => {
      await scanWallet(wallet, {
        forceRefresh: params.forceRefresh,
        refresh: params.refresh,
      });
    });
  }

  async function scanAll(forceRefresh = false) {
    const addresses = parsedWallets.addresses;
    if (!addresses.length) {
      setCurrentView("wallets");
      return;
    }

    await runWalletBatch({
      addresses,
      forceRefresh,
      refresh: !forceRefresh,
    });
  }

  async function scanPendingWallets() {
    const pendingAddresses = appliedRecords
      .filter((record) => !record.result && record.state !== "running" && record.state !== "error")
      .map((record) => record.address);
    await runWalletBatch({
      addresses: pendingAddresses,
      refresh: false,
    });
  }

  async function retryFailedWallets() {
    const failedAddresses = appliedRecords.filter((record) => record.state === "error").map((record) => record.address);
    await runWalletBatch({
      addresses: failedAddresses,
      refresh: true,
    });
  }

  function handlePrimaryAction() {
    if (primaryAction.kind === "manage-wallets") {
      setCurrentView("wallets");
      return;
    }
    if (primaryAction.kind === "scan-pending") {
      void scanPendingWallets();
      return;
    }
    if (primaryAction.kind === "retry-failed") {
      void retryFailedWallets();
      return;
    }
    if (primaryAction.kind === "refresh-all") {
      void scanAll(false);
    }
  }

  function confirmForceScanAll() {
    const ok = window.confirm("强制重扫会清空所有钱包当前快照日期的本地归档，并重新消耗 Ankr / RPC 额度。确认继续吗？");
    if (ok) void scanAll(true);
  }

  function confirmForceScanWallet(address: string) {
    const record = appliedRecords.find((item) => item.address === normalizeAddress(address));
    const label = record ? walletDisplayName(record) : shortAddress(address);
    const ok = window.confirm(`强制重扫 ${label} 会清空该钱包当前快照日期的本地归档，并重新消耗 Ankr / RPC 额度。确认继续吗？`);
    if (ok) void scanWallet(address, { forceRefresh: true });
  }

  function renameWallet(address: string) {
    const normalizedAddress = normalizeAddress(address);
    const record = appliedRecords.find((item) => item.address === normalizedAddress);
    const currentName = record?.name || "";
    const nextName = window.prompt("输入钱包名称。留空则恢复默认名称。", currentName);
    if (nextName === null) return;
    setWalletsText((current) => updateWalletNameInText(current, normalizedAddress, nextName));
  }

  function appendScanHistory(record: ScanHistoryRecord) {
    setScanHistory((current) => {
      const next = [record, ...current.filter((item) => item.id !== record.id)].slice(0, MAX_SCAN_HISTORY_RECORDS);
      if (!authSession) writePersistedScanHistory(next);
      return next;
    });
  }

  async function scanWallet(address: string, options: ScanWalletOptions = {}) {
    const normalizedAddress = normalizeAddress(address);
    const cached = authSession || options.forceRefresh ? null : readPersistedResult(normalizedAddress, endDate);
    if (cached && !options.refresh) {
      patchRecord(normalizedAddress, {
        state: "done",
        source: "archive",
        result: cached.result,
        savedAt: cached.savedAt,
        progress: "已使用本地归档",
        error: "",
      });
      return true;
    }
    const existingRecord = records.find((record) => record.address === normalizedAddress) || null;
    const existingResult = existingRecord?.result || null;
    const previousResult = options.forceRefresh ? null : cached?.result || existingResult;
    const previousSavedAt = cached?.savedAt || existingRecord?.savedAt;
    const keepPreviousResult = Boolean(options.refresh && previousResult && !options.forceRefresh);
    const runningProgress = options.forceRefresh
      ? "强制重扫链上记录..."
      : previousResult && options.refresh
        ? previousResult.scannedToBlock
          ? "增量刷新新区块..."
          : "补建归档检查点..."
        : "读取链上记录...";

    patchRecord(normalizedAddress, {
      state: "running",
      source: previousResult ? "archive" : "empty",
      result: keepPreviousResult ? previousResult : null,
      error: "",
      progress: runningProgress,
      savedAt: keepPreviousResult ? previousSavedAt : undefined,
    });

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const mode = scanModeFromOptions(options);

    try {
      const computed = await calculateBoostVolume({
        address: normalizedAddress,
        endDate,
        chain: BSC_CHAIN,
        apiKey: SERVER_MANAGED_EXPLORER_API_KEY,
        ankrMultichainRpcUrl: SERVER_MANAGED_ANKR_RPC_URL,
        boostBonuses: {},
        forceRefresh: options.forceRefresh,
        incrementalRefresh: options.refresh,
        previousResult: previousResult || undefined,
        onProgress: (message) => {
          patchRecord(normalizedAddress, { progress: message });
        },
      });
      const savedAt = new Date().toISOString();
      if (!authSession) writePersistedResult(normalizedAddress, endDate, computed, savedAt);
      appendScanHistory({
        id: `${normalizedAddress}:${endDate}:${startedAt}:${mode}`,
        address: normalizedAddress,
        snapshotDate: endDate,
        mode,
        status: "success",
        startedAt,
        endedAt: savedAt,
        durationMs: Date.now() - startedAtMs,
        source: computed.txDiscoverySource,
        scannedFromBlock: computed.scannedFromBlock,
        scannedToBlock: computed.scannedToBlock,
        incrementalFromBlock: computed.incrementalFromBlock,
        newTxCount: computed.incrementalNewTxCount,
        totalTxCount: computed.swaps.length,
        warningCount: visibleWarnings(computed.warnings).length,
      });
      patchRecord(normalizedAddress, {
        state: "done",
        source: "fresh",
        result: computed,
        savedAt,
        progress:
          typeof computed.incrementalNewTxCount === "number"
            ? `增量刷新完成，新增 ${computed.incrementalNewTxCount} 笔 OKX 交易`
            : "计算完成，已写入本地归档",
      });
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const endedAt = new Date().toISOString();
      appendScanHistory({
        id: `${normalizedAddress}:${endDate}:${startedAt}:${mode}`,
        address: normalizedAddress,
        snapshotDate: endDate,
        mode,
        status: "error",
        startedAt,
        endedAt,
        durationMs: Date.now() - startedAtMs,
        error: message,
      });
      patchRecord(normalizedAddress, {
        state: "error",
        error: message,
        progress: "计算失败",
      });
      return false;
    }
  }

  function patchRecord(address: string, patch: Partial<WalletArchiveRecord>) {
    const normalizedAddress = normalizeAddress(address);
    setRecords((current) =>
      current.map((record) => (record.address === normalizedAddress ? { ...record, ...patch } : record)),
    );
  }

  function updateBonusOverrides(value: string) {
    setBoostOverrides(value);
  }

  function hydrateServerArchive(archive: ServerArchivePayload) {
    const nextEndDate = archive.endDate && isUtcDate(archive.endDate) ? archive.endDate : endDate;
    const nextWalletsText = mergeWalletTexts({
      localText: walletsText,
      serverText: archive.walletsText || "",
      preserveLocal: !authSession && hasPersistedWalletState,
    });
    const nextRecords = hydrateRecordsFromServerArchive(archive, nextWalletsText, nextEndDate);

    setWalletsText(nextWalletsText);
    setEndDate(nextEndDate);
    if (archive.tenDayTarget !== undefined) setTenDayTarget(archive.tenDayTarget || DEFAULT_TEN_DAY_TARGET);
    if (archive.boostOverrides !== undefined) setBoostOverrides(archive.boostOverrides || "");
    if (archive.scanHistory) {
      const history = archive.scanHistory.filter(isScanHistoryRecord).slice(0, MAX_SCAN_HISTORY_RECORDS);
      setScanHistory(history);
      if (!authSession) writePersistedScanHistory(history);
    }
    setRecords(nextRecords);
    for (const record of nextRecords) {
      if (!authSession && record.result && record.savedAt) writePersistedResult(record.address, nextEndDate, record.result, record.savedAt);
    }
  }

  function resetSupabaseArchiveView() {
    setWalletsText("");
    setEndDate(maxSnapshotDate);
    setTenDayTarget(DEFAULT_TEN_DAY_TARGET);
    setBoostOverrides("");
    setSelectedWallet("");
    setScanHistory([]);
    setRecords([]);
  }

  function changeView(view: AppView) {
    setCurrentView(view);
    if (view !== "overview") setSelectedWallet("");
  }

  function openReportWallet(address: string) {
    setCurrentView("overview");
    setSelectedWallet(address);
  }

  async function sendFeishuSnapshotAlert() {
    const riskRow = snapshotForecastRows.find((row) => row.atRiskWallets > 0);
    if (!targetTotal || !riskRow || notifyState.status === "sending") return;

    setNotifyState({ status: "sending", message: "飞书提醒发送中..." });
    try {
      const response = await fetch("/api/feishu", {
        method: "POST",
        headers: authSession
          ? authHeaders(authSession, { "content-type": "application/json" })
          : serverAccessHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ text: buildFeishuForecastMessage(riskRow, targetTotal) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setNotifyState({ status: "sent", message: "飞书提醒已发送" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setNotifyState({ status: "error", message });
    }
  }

  async function submitAuth(mode: AuthMode, params: { email: string; password: string; inviteCode?: string }) {
    if (authState.status === "loading") return;
    setAuthState({ status: "loading", message: mode === "redeem" ? "正在兑换邀请码..." : "正在登录..." });
    try {
      setServerArchiveReady(false);
      setServerArchiveContext("");
      const session =
        mode === "redeem"
          ? await redeemInvite({ inviteCode: params.inviteCode || "", email: params.email, password: params.password })
          : await signInWithEmail(params.email, params.password);
      resetSupabaseArchiveView();
      setAuthSession(session);
      setServerArchiveReady(false);
      setArchiveSyncState({ status: "loading", message: "正在读取 Supabase 云端归档..." });
      setAuthState({ status: "ready", message: "已连接 Supabase 云端归档" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setAuthState({ status: "error", message });
    }
  }

  function signOut() {
    resetSupabaseArchiveView();
    setAuthSession(null);
    writeAuthSession(null);
    setAuthState({ status: "idle", message: "已退出云端账号" });
    setServerArchiveReady(false);
    setArchiveSyncState({ status: "loading", message: "正在切回私有归档..." });
  }

  return (
    <main className="app-frame">
      <Sidebar currentView={currentView} onViewChange={changeView} />

      <section className="main-workspace">
        <Topbar
          title={viewMeta.title}
          subtitle={viewMeta.subtitle}
          authSession={authSession}
          authState={authState}
          onAuthSubmit={submitAuth}
          onSignOut={signOut}
        />

        {currentView !== "wallets" && (
          <Toolbar
            endDate={endDate}
            maxSnapshotDate={maxSnapshotDate}
            walletFilter={walletFilter}
            archivedWallets={portfolio.archivedWallets}
            totalWallets={portfolio.totalWallets}
            anyRunning={anyRunning}
            primaryAction={primaryAction}
            onEndDateChange={setEndDate}
            onWalletFilterChange={setWalletFilter}
            onPrimaryAction={handlePrimaryAction}
            onForceScan={confirmForceScanAll}
          />
        )}

        {currentView === "overview" && (
          <div className="overview-workspace">
            <OverviewSummary
              portfolio={portfolio}
              targetTotal={targetTotal}
              primaryAction={primaryAction}
              tenDayTargetText={tenDayTarget}
              onTenDayTargetChange={setTenDayTarget}
            />

            <SnapshotForecastPanel
              rows={snapshotForecastRows}
              targetTotal={targetTotal}
              notifyState={notifyState}
              onNotify={sendFeishuSnapshotAlert}
              onSelectWallet={setSelectedWallet}
            />

            <WalletTablePanel
              records={filteredRecords}
              totalRecords={appliedRecords.length}
              endDate={endDate}
              targetTotal={targetTotal}
              selectedWallet={selectedWallet}
              disabled={anyRunning}
              onSelectWallet={setSelectedWallet}
              onScanWallet={(address) => scanWallet(address)}
              onRefreshWallet={(address) => scanWallet(address, { refresh: true })}
              onForceScanWallet={confirmForceScanWallet}
              onRenameWallet={renameWallet}
            />
          </div>
        )}

        {currentView === "wallets" && (
          <WalletManagementPage
            walletsText={walletsText}
            accessPassword={accessPassword}
            authSession={authSession}
            dataSpace={dataSpace}
            archiveSyncState={archiveSyncState}
            records={appliedRecords}
            validCount={parsedWallets.addresses.length}
            invalidCount={parsedWallets.invalid.length}
            duplicateCount={parsedWallets.duplicateCount}
            archivedWallets={portfolio.archivedWallets}
            anyRunning={anyRunning}
            onWalletsTextChange={setWalletsText}
            onAccessPasswordChange={setAccessPassword}
            onDataSpaceChange={(value) => setDataSpace(normalizeDataSpace(value))}
            onScanAll={() => scanAll(false)}
            onForceScanAll={confirmForceScanAll}
            onRenameWallet={renameWallet}
          />
        )}

        {currentView === "scan-records" && (
          <ScanRecordsPage records={scanHistoryRows} walletCount={portfolio.totalWallets} walletNameByAddress={walletNameByAddress} />
        )}

        {currentView === "reports" && (
          <ReportsPage
            records={appliedRecords}
            portfolio={portfolio}
            endDate={endDate}
            targetTotal={targetTotal}
            onSelectWallet={openReportWallet}
          />
        )}

        {currentView === "settings" && (
          <SettingsPage
            tenDayTargetText={tenDayTarget}
            targetTotal={targetTotal}
            portfolio={portfolio}
            scanHistoryCount={scanHistoryRows.length}
            accessPassword={accessPassword}
            authSession={authSession}
            onTenDayTargetChange={setTenDayTarget}
            onAccessPasswordChange={setAccessPassword}
          />
        )}

        {selectedRecord?.result && (
          <WalletDetailDrawer
            record={selectedRecord}
            bonusRules={boostOverrides}
            onBonusRulesChange={updateBonusOverrides}
            onRefresh={() => scanWallet(selectedRecord.address, { refresh: true })}
            onForceScan={() => confirmForceScanWallet(selectedRecord.address)}
            onRename={() => renameWallet(selectedRecord.address)}
            disabled={anyRunning}
            onClose={() => setSelectedWallet("")}
          />
        )}
      </section>
    </main>
  );
}

function Sidebar({
  currentView,
  onViewChange,
}: {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
}) {
  const groups: Array<{
    title?: string;
    items: Array<{ label: string; icon: LucideIcon; active?: boolean; badge?: string; onClick?: () => void; disabled?: boolean }>;
  }> = [
    {
      items: [
        { label: "总览", icon: Home, active: currentView === "overview", onClick: () => onViewChange("overview") },
        { label: "钱包管理", icon: WalletCards, active: currentView === "wallets", onClick: () => onViewChange("wallets") },
      ],
    },
    {
      title: "数据与扫描",
      items: [
        {
          label: "扫描记录",
          icon: ClipboardList,
          active: currentView === "scan-records",
          onClick: () => onViewChange("scan-records"),
        },
      ],
    },
    {
      title: "分析",
      items: [
        {
          label: "统计报表",
          icon: BarChart3,
          active: currentView === "reports",
          onClick: () => onViewChange("reports"),
        },
      ],
    },
    {
      title: "设置",
      items: [
        {
          label: "偏好设置",
          icon: Settings,
          active: currentView === "settings",
          onClick: () => onViewChange("settings"),
        },
      ],
    },
  ];

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>OKX Boost</strong>
          <small>钱包总览</small>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        {groups.map((group, groupIndex) => (
          <div className="nav-group" key={group.title || groupIndex}>
            {group.title && <p>{group.title}</p>}
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.label}
                  className={item.active ? "nav-item active" : "nav-item"}
                  onClick={item.onClick}
                  disabled={item.disabled}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {item.badge && <em>{item.badge}</em>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function Topbar({
  title,
  subtitle,
  authSession,
  authState,
  onAuthSubmit,
  onSignOut,
}: {
  title: string;
  subtitle: string;
  authSession: AuthSession | null;
  authState: AuthRequestState;
  onAuthSubmit: (mode: AuthMode, params: { email: string; password: string; inviteCode?: string }) => void;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <div className="topbar-actions">
        <AccountMenu
          authSession={authSession}
          authState={authState}
          onAuthSubmit={onAuthSubmit}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  );
}

function AccountMenu({
  authSession,
  authState,
  onAuthSubmit,
  onSignOut,
}: {
  authSession: AuthSession | null;
  authState: AuthRequestState;
  onAuthSubmit: (mode: AuthMode, params: { email: string; password: string; inviteCode?: string }) => void;
  onSignOut: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const busy = authState.status === "loading";

  return (
    <details className="account-menu">
      <summary className="user-chip">
        <UserCircle size={25} />
        <strong>{authSession?.user.email || "本机模式"}</strong>
        {authSession?.user.role === "admin" && <em>Admin</em>}
        <ChevronDown size={15} />
      </summary>
      <div className="account-popover">
        {authSession ? (
          <>
            <div className="account-status-card">
              <span>云端归档</span>
              <strong>{authSession.user.email}</strong>
              <small>
                {authSession.user.role === "admin" ? "管理员账号，可管理邀请码。" : "当前数据会保存到 Supabase 账号，不再依赖数据空间码。"}
              </small>
            </div>
            <button type="button" className="account-submit secondary" onClick={onSignOut}>
              <LogOut size={15} />
              退出登录
            </button>
          </>
        ) : (
          <>
            <div className="account-tabs" role="tablist" aria-label="账号操作">
              <button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>
                登录
              </button>
              <button type="button" className={mode === "redeem" ? "active" : ""} onClick={() => setMode("redeem")}>
                邀请注册
              </button>
            </div>
            <div className="account-form">
              {mode === "redeem" && (
                <label>
                  <span>邀请码</span>
                  <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="one-time-code" />
                </label>
              )}
              <label>
                <span>邮箱</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
              </label>
              <label>
                <span>密码</span>
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} />
              </label>
              <button
                type="button"
                className="account-submit"
                disabled={busy}
                onClick={() => onAuthSubmit(mode, { email, password, inviteCode })}
              >
                <LogIn size={15} />
                {busy ? "处理中" : mode === "redeem" ? "注册并登录" : "登录"}
              </button>
            </div>
          </>
        )}
        {authState.message && <p className={`account-message ${authState.status}`}>{authState.message}</p>}
      </div>
    </details>
  );
}

function Toolbar({
  endDate,
  maxSnapshotDate,
  walletFilter,
  archivedWallets,
  totalWallets,
  anyRunning,
  primaryAction,
  onEndDateChange,
  onWalletFilterChange,
  onPrimaryAction,
  onForceScan,
}: {
  endDate: string;
  maxSnapshotDate: string;
  walletFilter: WalletFilter;
  archivedWallets: number;
  totalWallets: number;
  anyRunning: boolean;
  primaryAction: PrimaryActionModel;
  onEndDateChange: (value: string) => void;
  onWalletFilterChange: (value: WalletFilter) => void;
  onPrimaryAction: () => void;
  onForceScan: () => void;
}) {
  return (
    <section className="toolbar" aria-label="扫描工具条">
      <div className="snapshot-label">
        <span>快照日：</span>
        <strong>{endDate} UTC 日结</strong>
        <Clock3 size={16} />
      </div>

      <label className="toolbar-control date-control">
        <CalendarDays size={17} />
        <span>最近 10 天</span>
        <strong>{formatToolbarDate(endDate)}</strong>
        <input
          type="date"
          aria-label="选择快照日期"
          title="选择快照日期"
          max={maxSnapshotDate}
          value={endDate}
          onChange={(event) => onEndDateChange(event.target.value)}
        />
      </label>

      <label className="toolbar-control select-control">
        <WalletCards size={17} />
        <select value={walletFilter} onChange={(event) => onWalletFilterChange(event.target.value as WalletFilter)}>
          <option value="all">所有钱包</option>
          <option value="archived">已归档</option>
          <option value="running">扫描中</option>
          <option value="pending">待扫描</option>
          <option value="error">失败</option>
        </select>
        <ChevronDown size={15} />
      </label>

      <div className="archive-pill">
        <CheckCircle2 size={16} />
        <strong>已归档</strong>
        <span>{archivedWallets}/{totalWallets || 0}</span>
      </div>

      <button
        type="button"
        className="toolbar-primary-button"
        onClick={onPrimaryAction}
        disabled={Boolean(primaryAction.disabled)}
        title={primaryAction.description}
      >
        <RefreshCcw size={17} />
        {primaryAction.label}
      </button>

      <details className="toolbar-more">
        <summary aria-label="更多操作">
          <MoreHorizontal size={18} />
          <span>更多</span>
        </summary>
        <div className="toolbar-more-menu">
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onForceScan();
            }}
            disabled={anyRunning}
            className="danger-action"
          >
            <RefreshCcw size={15} />
            强制重扫全部
          </button>
        </div>
      </details>
    </section>
  );
}

function WalletManagementPage({
  walletsText,
  accessPassword,
  authSession,
  dataSpace,
  archiveSyncState,
  records,
  validCount,
  invalidCount,
  duplicateCount,
  archivedWallets,
  anyRunning,
  onWalletsTextChange,
  onAccessPasswordChange,
  onDataSpaceChange,
  onScanAll,
  onForceScanAll,
  onRenameWallet,
}: {
  walletsText: string;
  accessPassword: string;
  authSession: AuthSession | null;
  dataSpace: string;
  archiveSyncState: ArchiveSyncState;
  records: WalletArchiveRecord[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  archivedWallets: number;
  anyRunning: boolean;
  onWalletsTextChange: (value: string) => void;
  onAccessPasswordChange: (value: string) => void;
  onDataSpaceChange: (value: string) => void;
  onScanAll: () => void;
  onForceScanAll: () => void;
  onRenameWallet: (address: string) => void;
}) {
  const runningCount = records.filter((record) => record.state === "running").length;
  const failedCount = records.filter((record) => record.state === "error").length;
  const pendingCount = records.filter((record) => !record.result && record.state !== "running" && record.state !== "error").length;
  const walletLineCount = walletsText.split(/\n+/).filter((line) => line.trim()).length;
  const archivedPercent = validCount > 0 ? Math.round((archivedWallets / validCount) * 100) : 0;
  const accessCodeState = authSession ? "云端账号" : accessPassword ? "已填写" : "未填写";
  const archiveScopeLabel = authSession ? "Supabase" : dataSpace || DEFAULT_DATA_SPACE;
  const maxWallets = Number(authSession?.user.maxWallets || 0);
  const walletQuotaExceeded = Boolean(authSession && maxWallets > 0 && validCount > maxWallets);
  const walletQuotaLabel = authSession ? `${validCount}/${maxWallets || "不限"}` : "--";

  return (
    <section className="work-page wallet-management-page">
      <section className="wallet-command-strip">
        <div className="wallet-command-copy">
          <span>钱包源</span>
          <strong>{validCount} 个有效地址</strong>
          <p>{invalidCount || duplicateCount ? `有 ${invalidCount} 个无效行、${duplicateCount} 个重复行需要处理。` : "地址格式正常，可以直接刷新新增交易。"}</p>
        </div>
        <div className="wallet-command-metrics">
          <MetricLine label="已归档" value={`${archivedWallets}/${validCount || 0}`} />
          <MetricLine label="待扫描" value={String(pendingCount)} />
          <MetricLine label="失败" value={String(failedCount)} />
          <MetricLine label="归档" value={archiveScopeLabel} />
          <MetricLine label="钱包上限" value={walletQuotaLabel} />
        </div>
        <div className="wallet-management-actions">
          <button type="button" onClick={onScanAll} disabled={anyRunning || validCount === 0 || walletQuotaExceeded}>
            <RefreshCcw size={16} />
            刷新新增交易
          </button>
          <button type="button" onClick={onForceScanAll} disabled={anyRunning || validCount === 0 || walletQuotaExceeded} className="danger-action">
            <RefreshCcw size={16} />
            强制重扫全部
          </button>
        </div>
      </section>

      <div className="wallet-management-grid">
        <section className="wallet-editor-surface">
          <div className="wallet-editor-head">
            <div>
              <span>源数据</span>
              <h2>钱包地址</h2>
            </div>
            <em>{walletLineCount} 行</em>
          </div>

          <label className="wallet-address-editor">
            <span>
              <Wallet size={16} /> 名称与地址
            </span>
            <textarea
              value={walletsText}
              onChange={(event) => onWalletsTextChange(event.target.value)}
              placeholder="MyanDong 0x..."
              spellCheck={false}
            />
            <small>支持一行一个地址，也支持「名称 地址」。</small>
          </label>

          {walletQuotaExceeded && (
            <div className="wallet-quota-warning">
              当前账号最多保存 {maxWallets} 个钱包，请减少 {validCount - maxWallets} 个地址后再同步或扫描。
            </div>
          )}

          {authSession ? (
            <div className="access-code-panel">
              <span>
                <ShieldCheck size={16} /> 云端账号
              </span>
              <strong>{authSession.user.email}</strong>
              <small>已登录时，钱包列表和扫描归档保存到 Supabase 账号。钱包上限 {walletQuotaLabel}。</small>
            </div>
          ) : (
            <>
              <label className="access-code-panel">
                <span>
                  <LockKeyhole size={16} /> 私有访问码
                </span>
                <input
                  type="password"
                  value={accessPassword}
                  onChange={(event) => onAccessPasswordChange(event.target.value)}
                  placeholder="私人部署需要时填写"
                  autoComplete="current-password"
                />
                <small>只保存在本机浏览器。</small>
              </label>

              <label className="access-code-panel">
                <span>
                  <ShieldCheck size={16} /> 数据空间码
                </span>
                <input
                  type="text"
                  value={dataSpace}
                  onChange={(event) => onDataSpaceChange(event.target.value)}
                  placeholder={DEFAULT_DATA_SPACE}
                  autoComplete="off"
                />
                <small>未登录时，不同用户使用不同数据空间码；换设备时填写同一个码即可恢复同一份归档。</small>
              </label>
            </>
          )}
        </section>

        <aside className="wallet-management-side">
          <section className="wallet-side-panel">
            <div className="settings-card-title">
              <Gauge size={18} />
              <h2>归档状态</h2>
            </div>
            <div className={`archive-sync-status ${archiveSyncState.status}`}>
              <span>{archiveSyncState.message}</span>
              <small>访问码 {accessCodeState}</small>
            </div>
            <div className="wallet-archive-meter">
              <div>
                <strong>{archivedPercent}%</strong>
                <span>{archivedWallets}/{validCount || 0} 已归档</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${archivedPercent}%` }} />
              </div>
            </div>
            <div className="wallet-mini-grid">
              <MetricLine label="扫描中" value={String(runningCount)} />
              <MetricLine label="待扫描" value={String(pendingCount)} />
              <MetricLine label="失败" value={String(failedCount)} />
              <MetricLine label="重复行" value={String(duplicateCount)} />
            </div>
          </section>

          <section className="wallet-side-panel wallet-preview-panel">
            <div className="settings-card-title">
              <WalletCards size={18} />
              <h2>当前钱包</h2>
            </div>
            <div className="wallet-current-list">
              {records.map((record, index) => (
                <article key={record.address} className="wallet-current-row">
                  <div className="wallet-avatar">{walletDisplayName(record, index).slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong>{walletDisplayName(record, index)}</strong>
                    <span>{shortAddress(record.address)}</span>
                  </div>
                  <em className={`wallet-current-status ${walletManagementStatus(record).tone}`}>
                    {walletManagementStatus(record).label}
                  </em>
                  <button
                    type="button"
                    className="wallet-current-action"
                    onClick={() => onRenameWallet(record.address)}
                    title={`重命名 ${walletDisplayName(record, index)}`}
                  >
                    <PencilLine size={13} />
                    重命名
                  </button>
                </article>
              ))}
              {records.length === 0 && <div className="empty-detail-state">暂无钱包。</div>}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function WalletTablePanel({
  records,
  totalRecords,
  endDate,
  targetTotal,
  selectedWallet,
  disabled,
  onSelectWallet,
  onScanWallet,
  onRefreshWallet,
  onForceScanWallet,
  onRenameWallet,
}: {
  records: WalletArchiveRecord[];
  totalRecords: number;
  endDate: string;
  targetTotal: number | null;
  selectedWallet: string;
  disabled: boolean;
  onSelectWallet: (address: string) => void;
  onScanWallet: (address: string) => void;
  onRefreshWallet: (address: string) => void;
  onForceScanWallet: (address: string) => void;
  onRenameWallet: (address: string) => void;
}) {
  return (
    <section className="wallet-table-card">
      <div className="table-card-header">
        <div>
          <h2>所有钱包</h2>
          <span>{records.length} / {totalRecords} 条</span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="wallet-table">
          <thead>
            <tr>
              <th>钱包地址</th>
              <th>状态</th>
              <th>10 日合计 Boost</th>
              <th>10 日平均 Boost</th>
              <th>今日 Boost</th>
              <th>目标差额</th>
              <th>最后扫描</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <WalletRow
                key={record.address}
                record={record}
                index={index}
                endDate={endDate}
                targetTotal={targetTotal}
                selected={selectedWallet === record.address}
                disabled={disabled}
                onSelect={() => onSelectWallet(record.address)}
                onScan={() => onScanWallet(record.address)}
                onRefresh={() => onRefreshWallet(record.address)}
                onForceScan={() => onForceScanWallet(record.address)}
                onRename={() => onRenameWallet(record.address)}
              />
            ))}
            {records.length === 0 && (
              <tr>
                  <td colSpan={8} className="empty-row">
                    当前筛选下没有钱包。请到钱包管理页面添加地址或切换筛选条件。
                  </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WalletRow({
  record,
  index,
  endDate,
  targetTotal,
  selected,
  disabled,
  onSelect,
  onScan,
  onRefresh,
  onForceScan,
  onRename,
}: {
  record: WalletArchiveRecord;
  index: number;
  endDate: string;
  targetTotal: number | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onScan: () => void;
  onRefresh: () => void;
  onForceScan: () => void;
  onRename: () => void;
}) {
  const todayRow = record.result?.dailyRows.find((row) => row.date === endDate);
  const targetDelta = record.result && targetTotal !== null ? record.result.totalBoostVolume - targetTotal : null;
  const displayName = walletDisplayName(record, index);
  const canOpenDetail = Boolean(record.result);

  return (
    <tr className={`${selected ? "selected-row" : ""} ${canOpenDetail ? "interactive-row" : ""}`} onClick={canOpenDetail ? onSelect : undefined}>
      <td>
        <button
          className="wallet-identity"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <span className="wallet-avatar">{displayName.slice(0, 1)}</span>
          <span>
            <strong>{displayName}</strong>
            <small>
              {shortAddress(record.address)}
              <Copy size={12} />
            </small>
          </span>
        </button>
      </td>
      <td>
        <StatusCell record={record} />
      </td>
      <td>{record.result ? formatUsd(record.result.totalBoostVolume) : "--"}</td>
      <td>{record.result ? formatUsd(record.result.averageBoostVolume) : "--"}</td>
      <td>{todayRow ? formatUsd(todayRow.boostVolume) : "--"}</td>
      <td>
        {targetDelta === null ? (
          "--"
        ) : (
          <span className={targetDelta >= 0 ? "target-delta positive" : "target-delta negative"}>
            {targetDelta >= 0 ? "+" : "-"}
            {formatUsd(Math.abs(targetDelta))}
          </span>
        )}
      </td>
      <td>
        {formatSavedAt(record.savedAt)}
        <small>{lastScanLabel(record)}</small>
      </td>
      <td>
        <div className="row-actions">
          <button
            type="button"
            className="row-rename-button"
            onClick={(event) => {
              event.stopPropagation();
              onRename();
            }}
            title="重命名钱包"
          >
            重命名
          </button>
          {record.state === "running" ? (
            <button type="button" className="row-detail-button" disabled>
              扫描中
            </button>
          ) : record.state === "error" ? (
            <button
              type="button"
              className="row-detail-button error-action"
              onClick={(event) => {
                event.stopPropagation();
                onRefresh();
              }}
              disabled={disabled}
            >
              重试
            </button>
          ) : record.result ? (
            <>
              <button
                type="button"
                className="row-detail-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                }}
              >
                详情
                <ChevronRight size={15} />
              </button>
              <button
                type="button"
                className="row-refresh-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRefresh();
                }}
                disabled={disabled}
                title="只扫描新区块"
              >
                <RefreshCcw size={15} />
                刷新新增
              </button>
            </>
          ) : (
            <button
              type="button"
              className="row-detail-button"
              onClick={(event) => {
                event.stopPropagation();
                onScan();
              }}
              disabled={disabled}
            >
              扫描
            </button>
          )}
          {record.result && (
            <button
              type="button"
              className="row-rescan-button"
              onClick={(event) => {
                event.stopPropagation();
                onForceScan();
              }}
              disabled={disabled}
              title="清空该钱包归档后完整重扫"
            >
              <RefreshCcw size={15} />
              重扫
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatusCell({ record }: { record: WalletArchiveRecord }) {
  if (record.state === "running") {
    return (
      <span className="status-cell running">
        <strong>
          <Clock3 size={14} /> 扫描中
        </strong>
        <small>预计 2 分钟</small>
      </span>
    );
  }
  if (record.state === "error") {
    return (
      <span className="status-cell error">
        <strong>
          <AlertCircle size={14} /> 失败
        </strong>
        <small>需要重试</small>
      </span>
    );
  }
  if (record.result) {
    const archiveHint =
      typeof record.result.incrementalNewTxCount === "number"
        ? `新增 ${record.result.incrementalNewTxCount} 笔`
        : record.source === "fresh"
          ? discoverySourceLabel(record.result.txDiscoverySource)
          : "无需重复扫描";
    return (
      <span className="status-cell archived">
        <strong>
          <CheckCircle2 size={14} /> 已归档
        </strong>
        <small>{archiveHint}</small>
      </span>
    );
  }
  return (
    <span className="status-cell pending">
      <strong>
        <Clock3 size={14} /> 等待扫描
      </strong>
      <small>未开始</small>
    </span>
  );
}

function OverviewSummary({
  portfolio,
  targetTotal,
  primaryAction,
  tenDayTargetText,
  onTenDayTargetChange,
}: {
  portfolio: PortfolioSummary;
  targetTotal: number | null;
  primaryAction: PrimaryActionModel;
  tenDayTargetText: string;
  onTenDayTargetChange: (value: string) => void;
}) {
  const equivalentDaily = targetTotal ? formatUsd(targetTotal / 10) : "--";
  const targetRateLabel = targetTotal ? `${formatNumber(portfolio.targetRate, 1)}%` : "--";
  const activeQueue = portfolio.runningWallets + portfolio.pendingWallets;
  const targetTotalForAllWallets = targetTotal ? targetTotal * portfolio.totalWallets : null;
  const targetTotalLabel = targetTotalForAllWallets ? formatUsd(targetTotalForAllWallets) : "";
  const decisionText = overviewDecisionText(portfolio, targetTotal, primaryAction);
  return (
    <section className="overview-summary-card">
      <div className="overview-card-title">
        <div>
          <span className="overview-kicker">全局达标状态</span>
          <h2>总体概览</h2>
          <span>首页只保留所有钱包的达标判断；代币与交易明细从钱包行进入。</span>
        </div>
      </div>

      <div className="overview-summary-grid">
        <article className="overview-primary-panel">
          <div>
            <span>当前总进度</span>
            <strong>{formatUsd(portfolio.totalBoostVolume)}</strong>
            {targetTotalLabel && <em>目标 {targetTotalLabel}</em>}
          </div>
          <small>{decisionText}</small>
        </article>

        <article className="overview-target-panel">
          <label className="target-input-control">
            <span>单钱包 10 日累计目标</span>
            <input
              type="number"
              min="0"
              step="1"
              value={tenDayTargetText}
              onChange={(event) => onTenDayTargetChange(event.target.value)}
              placeholder={DEFAULT_TEN_DAY_TARGET}
            />
            <small>等效日均 {equivalentDaily}</small>
          </label>

          <div className="target-progress">
            <div>
              <span>目标达成率</span>
              <strong>{targetRateLabel}</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${targetTotal ? Math.min(portfolio.targetRate, 100) : 0}%` }} />
            </div>
          </div>
        </article>

        <div className="overview-secondary-grid">
          <MetricLine label="10 日平均 Boost" value={formatUsd(portfolio.averageBoostVolume)} />
          <MetricLine label="今日 Boost" value={formatUsd(portfolio.todayBoostVolume)} />
          <MetricLine label="钱包归档" value={`${portfolio.archivedWallets}/${portfolio.totalWallets}`} />
          <MetricLine label="待处理钱包" value={String(activeQueue)} />
        </div>
      </div>
    </section>
  );
}

function SnapshotForecastPanel({
  rows,
  targetTotal,
  notifyState,
  onNotify,
  onSelectWallet,
}: {
  rows: SnapshotForecastRow[];
  targetTotal: number | null;
  notifyState: NotifyState;
  onNotify: () => void;
  onSelectWallet: (address: string) => void;
}) {
  const currentRow = rows[0] || null;
  const hasArchivedWallets = Boolean(currentRow?.archivedWallets);
  const firstRiskRow = targetTotal && hasArchivedWallets ? rows.find((row) => row.atRiskWallets > 0) || null : null;
  const allClear = Boolean(targetTotal && hasArchivedWallets && !firstRiskRow);
  const nextActionText = targetTotal
    ? !hasArchivedWallets
      ? "暂无已归档钱包。先扫描或刷新钱包，再判断未来快照风险。"
      : firstRiskRow
      ? `${firstRiskRow.runLabel} 有 ${firstRiskRow.atRiskWallets} 个钱包低于 ${formatUsd(targetTotal)}，最大差额 ${formatUsd(firstRiskRow.worstGap)}。`
      : "当前快照和未来 3 次日结快照按无新增交易估算均达标。"
    : "先设置单钱包 10 日累计目标，才能判断未来快照风险。";

  return (
    <section className={`snapshot-forecast-card ${firstRiskRow ? "risk" : "safe"}`}>
      <div className="forecast-header">
        <div>
          <span className="overview-kicker">UTC 日结快照</span>
          <h2>快照预警</h2>
          <p>北京时间每日 {SNAPSHOT_CONFIRM_TIME_LABEL} 确认上一 UTC 日；窗口固定为快照日及前 9 天，未来日期默认无新增交易。</p>
        </div>
        <div className="forecast-header-actions">
          <div className={allClear ? "forecast-verdict safe" : "forecast-verdict risk"}>
            {allClear ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <strong>{allClear ? "未来 3 天安全" : firstRiskRow ? "需要补量" : hasArchivedWallets ? "等待目标" : "等待归档"}</strong>
          </div>
          {firstRiskRow && (
            <button
              type="button"
              className="forecast-notify-button"
              onClick={onNotify}
              disabled={notifyState.status === "sending"}
            >
              <Send size={16} />
              {notifyState.status === "sending" ? "发送中" : "飞书提醒"}
            </button>
          )}
        </div>
      </div>

      <div className="forecast-decision">
        <ShieldCheck size={18} />
        <span>{nextActionText}</span>
        {notifyState.message && (
          <em className={`forecast-notify-status ${notifyState.status}`}>{notifyState.message}</em>
        )}
      </div>

      {targetTotal && hasArchivedWallets ? (
        <div className="forecast-timeline" role="list" aria-label="快照预测列表">
          {rows.map((row, index) => {
            const riskWallets = row.walletRows.filter((wallet) => !wallet.targetMet).slice(0, 2);
            const rowIsRisk = row.atRiskWallets > 0;
            return (
              <article className={rowIsRisk ? "forecast-row risk" : "forecast-row safe"} key={row.snapshotDate} role="listitem">
                <div className="forecast-date">
                  <span>{index === 0 ? "当前快照" : `未来 +${index} 天`}</span>
                  <strong>{row.snapshotDate}</strong>
                  <small>确认时间 {row.runLabel}</small>
                </div>

                <div className="forecast-window">
                  <span>统计窗口</span>
                  <strong>
                    {row.windowStart} 至 {row.windowEnd}
                  </strong>
                  <small>
                    {index === 0
                      ? "当前窗口"
                      : row.expiredBoostVolume > 0
                        ? `到期交易量 ${formatUsd(row.expiredBoostVolume)}`
                        : "无到期交易量"}
                  </small>
                </div>

                <div className="forecast-total">
                  <span>归档合计</span>
                  <strong>{formatUsd(row.totalBoostVolume)}</strong>
                  <small>{row.targetMetWallets}/{row.archivedWallets} 个钱包达标</small>
                </div>

                <div className="forecast-status">
                  <span className={rowIsRisk ? "forecast-status-pill risk" : "forecast-status-pill safe"}>
                    {rowIsRisk ? "不足" : "达标"}
                  </span>
                  <strong>{rowIsRisk ? `${row.atRiskWallets} 个钱包` : "无风险"}</strong>
                  <small>{rowIsRisk ? `最大差额 ${formatUsd(row.worstGap)}` : "无需补刷"}</small>
                </div>

                <div className="forecast-wallets">
                  {rowIsRisk ? (
                    riskWallets.map((wallet) => (
                      <button
                        type="button"
                        className="forecast-wallet-button"
                        key={wallet.address}
                        onClick={() => onSelectWallet(wallet.address)}
                        title="打开钱包详情"
                      >
                        <span>{wallet.name}</span>
                        <strong>差 {formatUsd(wallet.gap)}</strong>
                        <ChevronRight size={14} />
                      </button>
                    ))
                  ) : (
                    <span className="forecast-wallet-empty">已归档钱包都满足目标</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="forecast-empty-state">
          {currentRow?.archivedWallets ? "请先填写目标金额。" : "暂无可预测的已归档钱包。先刷新新增交易或扫描待处理钱包。"}
        </div>
      )}
    </section>
  );
}

function MetricLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "metric-line strong" : "metric-line"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScanRecordsPage({
  records,
  walletCount,
  walletNameByAddress,
}: {
  records: ScanHistoryRecord[];
  walletCount: number;
  walletNameByAddress: Map<string, string>;
}) {
  return (
    <section className="work-page">
      <PageHeader
        icon={ClipboardList}
        title="扫描记录"
        eyebrow={`${records.length} 条记录 · ${walletCount} 个钱包`}
        description="这里只记录真正发生过的扫描、增量刷新和强制重扫，用来判断是否重复扫、是否命中增量、失败在哪里。"
      />

      <div className="audit-table-card">
        <div className="table-card-header">
          <div>
            <h2>最近扫描</h2>
            <span>{records.length}</span>
          </div>
        </div>
        <div className="table-scroll audit-table-scroll">
          <table className="compact-table audit-table">
            <thead>
              <tr>
                <th>完成时间</th>
                <th>钱包</th>
                <th>方式</th>
                <th>状态</th>
                <th>来源</th>
                <th>区块范围</th>
                <th>新增 / 总交易</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    {formatSavedAt(record.endedAt)}
                    <small>{record.snapshotDate} 快照</small>
                  </td>
                  <td>
                    {walletNameLabel(record.address, walletNameByAddress)}
                    <small>{shortAddress(record.address)}</small>
                  </td>
                  <td>{scanModeLabel(record.mode)}</td>
                  <td>
                    <span className={`scan-status ${record.status}`}>{scanStatusLabel(record)}</span>
                  </td>
                  <td>{record.source ? discoverySourceLabel(record.source) : "--"}</td>
                  <td>
                    {blockRangeLabel(record)}
                    {record.incrementalFromBlock && <small>增量起点 {formatNumber(record.incrementalFromBlock, 0)}</small>}
                  </td>
                  <td>
                    {typeof record.newTxCount === "number" ? record.newTxCount : "--"} /{" "}
                    {typeof record.totalTxCount === "number" ? record.totalTxCount : "--"}
                    {record.warningCount ? <small>{record.warningCount} 条提示</small> : null}
                  </td>
                  <td>
                    {formatDuration(record.durationMs)}
                    {record.error && <small>{record.error}</small>}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    还没有扫描记录。先在总览里扫描或刷新一个钱包。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ReportsPage({
  records,
  portfolio,
  endDate,
  targetTotal,
  onSelectWallet,
}: {
  records: WalletArchiveRecord[];
  portfolio: PortfolioSummary;
  endDate: string;
  targetTotal: number | null;
  onSelectWallet: (address: string) => void;
}) {
  const dailyRows = buildDailyPortfolioRows(records);
  const rankingRows = buildWalletRankingRows(records, endDate, targetTotal);
  const sourceRows = buildSourceBreakdownRows(records);
  const targetTotalForAllWallets = targetTotal ? targetTotal * records.length : 0;
  const nextAction = targetTotal
    ? portfolio.targetGap > 0
      ? `还差 ${formatUsd(portfolio.targetGap)}，优先刷新目标差额最大的已归档钱包。`
      : `已超出目标 ${formatUsd(Math.abs(portfolio.targetGap))}，保持今日归档即可。`
    : "填写 10 日累计目标后，系统会给出达标差额。";

  return (
    <section className="work-page">
      <PageHeader
        icon={Gauge}
        title="统计报表"
        eyebrow={`快照 ${endDate} · ${portfolio.archivedWallets}/${portfolio.totalWallets} 已归档`}
        description="报表只回答一个问题：按当前归档和加成规则，哪些钱包还没达到 10 日累计目标。"
      />

      <div className="report-metric-grid">
        <MetricPanel label="10 日累计 Boost" value={formatUsd(portfolio.totalBoostVolume)} />
        <MetricPanel label="总目标" value={targetTotal ? formatUsd(targetTotalForAllWallets) : "--"} />
        <MetricPanel label="目标差额" value={targetTotal ? targetGapLabel(portfolio.targetGap) : "--"} tone={portfolio.targetGap > 0 ? "danger" : "success"} />
        <MetricPanel label="达成率" value={targetTotal ? `${formatNumber(portfolio.targetRate, 1)}%` : "--"} />
      </div>

      <div className="decision-card">
        <ShieldCheck size={18} />
        <span>{nextAction}</span>
      </div>

      <div className="report-grid">
        <section className="audit-table-card">
          <div className="table-card-header">
            <div>
              <h2>钱包达标排序</h2>
              <span>{rankingRows.length}</span>
            </div>
          </div>
          <div className="table-scroll report-table-scroll">
            <table className="compact-table report-wallet-table">
              <thead>
                <tr>
                  <th>钱包</th>
                  <th>10 日累计</th>
                  <th>今日</th>
                  <th>有效交易</th>
                  <th>目标差额</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rankingRows.map((row) => (
                  <tr key={row.address}>
                    <td>
                      {row.name}
                      <small>{shortAddress(row.address)}</small>
                    </td>
                    <td>
                      {formatUsd(row.totalBoostVolume)}
                      <small>日均 {formatUsd(row.averageBoostVolume)}</small>
                    </td>
                    <td>{formatUsd(row.todayBoostVolume)}</td>
                    <td>{row.countedTxCount}</td>
                    <td>
                      {row.targetDelta === null ? (
                        "--"
                      ) : (
                        <span className={row.targetDelta >= 0 ? "target-delta positive" : "target-delta negative"}>
                          {row.targetDelta >= 0 ? "+" : "-"}
                          {formatUsd(Math.abs(row.targetDelta))}
                        </span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="row-detail-button" onClick={() => onSelectWallet(row.address)}>
                        查看详情
                        <ChevronRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
                {rankingRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-row">
                      还没有可统计的钱包归档。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="audit-table-card">
          <div className="table-card-header">
            <div>
              <h2>每日合计</h2>
              <span>{dailyRows.length}</span>
            </div>
          </div>
          <div className="daily-report-list">
            {dailyRows.map((row) => (
              <article className="daily-report-row" key={row.date}>
                <div>
                  <strong>{row.date}</strong>
                  <span>{row.txCount} 笔有效交易</span>
                </div>
                <div>
                  <strong>{formatUsd(row.boostVolume)}</strong>
                  <span>成交额 {formatUsd(row.tradeUsd, true)}</span>
                </div>
              </article>
            ))}
            {dailyRows.length === 0 && <div className="empty-detail-state">还没有每日归档数据。</div>}
          </div>
        </section>

        <section className="audit-table-card report-side-card">
          <div className="table-card-header">
            <div>
              <h2>来源分布</h2>
              <span>{sourceRows.length}</span>
            </div>
          </div>
          <div className="source-breakdown">
            {sourceRows.map((row) => (
              <article key={row.label}>
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.walletCount} 个钱包</span>
                </div>
                <strong>{formatUsd(row.boostVolume)}</strong>
              </article>
            ))}
            {sourceRows.length === 0 && <div className="empty-detail-state">暂无来源数据。</div>}
          </div>
        </section>
      </div>
    </section>
  );
}

function SettingsPage({
  tenDayTargetText,
  targetTotal,
  portfolio,
  scanHistoryCount,
  accessPassword,
  authSession,
  onTenDayTargetChange,
  onAccessPasswordChange,
}: {
  tenDayTargetText: string;
  targetTotal: number | null;
  portfolio: PortfolioSummary;
  scanHistoryCount: number;
  accessPassword: string;
  authSession: AuthSession | null;
  onTenDayTargetChange: (value: string) => void;
  onAccessPasswordChange: (value: string) => void;
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "user">("user");
  const [inviteMaxWallets, setInviteMaxWallets] = useState("20");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState("14");
  const [inviteRows, setInviteRows] = useState<AdminInvite[]>([]);
  const [inviteState, setInviteState] = useState<InviteAdminState>({ status: "idle", message: "" });
  const [userRows, setUserRows] = useState<AdminUserProfile[]>([]);
  const [userQuotaDrafts, setUserQuotaDrafts] = useState<Record<string, string>>({});
  const [userState, setUserState] = useState<InviteAdminState>({ status: "idle", message: "" });
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [notificationState, setNotificationState] = useState<InviteAdminState>({ status: "idle", message: "" });
  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [feishuWebhook, setFeishuWebhook] = useState("");
  const [feishuSecret, setFeishuSecret] = useState("");
  const [notifyFutureDays, setNotifyFutureDays] = useState("3");
  const isAdminSession = authSession?.user.role === "admin" && authSession.user.status !== "disabled";
  const adminAuth = { session: isAdminSession ? authSession : null, accessPassword };
  const adminReady = isAdminSession || Boolean(accessPassword.trim());
  const adminModeLabel = isAdminSession ? "管理员账号" : "初始化访问码";
  const notificationBusy = notificationState.status === "loading";

  useEffect(() => {
    if (!authSession) {
      setNotificationSettings(null);
      setNotificationState({ status: "idle", message: "" });
      setFeishuEnabled(false);
      setFeishuWebhook("");
      setFeishuSecret("");
      setNotifyFutureDays("3");
      return;
    }
    void refreshNotificationSettings();
  }, [authSession?.accessToken]);

  function applyNotificationSettings(settings: NotificationSettings) {
    setNotificationSettings(settings);
    setFeishuEnabled(settings.feishuEnabled);
    setNotifyFutureDays(String(settings.notifyFutureDays));
    setFeishuWebhook("");
    setFeishuSecret("");
  }

  async function refreshNotificationSettings() {
    if (!authSession) {
      setNotificationState({ status: "error", message: "请先登录账号。" });
      return;
    }
    setNotificationState({ status: "loading", message: "正在读取飞书配置..." });
    try {
      const settings = await getNotificationSettings(authSession);
      applyNotificationSettings(settings);
      setNotificationState({ status: "ready", message: settings.feishuConfigured ? "已读取飞书配置。" : "尚未保存飞书 Webhook。" });
    } catch (caught) {
      setNotificationState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function saveNotificationSettings() {
    if (!authSession || notificationBusy) {
      setNotificationState({ status: "error", message: "请先登录账号。" });
      return;
    }
    const days = Number(notifyFutureDays);
    if (!Number.isInteger(days) || days < 0 || days > 30) {
      setNotificationState({ status: "error", message: "风险预测天数必须是 0 到 30 的整数。" });
      return;
    }
    setNotificationState({ status: "loading", message: "正在保存飞书配置..." });
    try {
      const settings = await updateNotificationSettings(
        {
          feishuEnabled,
          notifyFutureDays: days,
          ...(feishuWebhook.trim() ? { feishuWebhook: feishuWebhook.trim() } : {}),
          ...(feishuSecret.trim() ? { feishuSecret: feishuSecret.trim() } : {}),
        },
        authSession,
      );
      applyNotificationSettings(settings);
      setNotificationState({ status: "ready", message: settings.feishuEnabled ? "飞书提醒已启用。" : "飞书配置已保存，提醒未启用。" });
    } catch (caught) {
      setNotificationState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function clearNotificationSettings() {
    if (!authSession || notificationBusy) return;
    if (!window.confirm("确认清除当前账号保存的飞书机器人配置？")) return;
    setNotificationState({ status: "loading", message: "正在清除飞书配置..." });
    try {
      const settings = await updateNotificationSettings({ clearFeishuWebhook: true, notifyFutureDays: 3 }, authSession);
      applyNotificationSettings(settings);
      setNotificationState({ status: "ready", message: "飞书配置已清除。" });
    } catch (caught) {
      setNotificationState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function sendNotificationTest() {
    if (!authSession || notificationBusy) {
      setNotificationState({ status: "error", message: "请先登录账号。" });
      return;
    }
    setNotificationState({ status: "loading", message: "正在读取真实归档并发送测试..." });
    try {
      const response = await fetch("/api/feishu", {
        method: "POST",
        headers: authHeaders(authSession, { "content-type": "application/json" }),
        body: JSON.stringify({
          mode: "real-data-test",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setNotificationState({ status: "ready", message: "真实数据测试已发送。" });
    } catch (caught) {
      setNotificationState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function refreshInvites() {
    if (!adminReady) {
      setInviteState({ status: "error", message: "请先登录管理员账号，或在首个管理员初始化时填写私有访问码。" });
      return;
    }
    setInviteState({ status: "loading", message: "正在读取邀请码..." });
    try {
      const rows = await listAdminInvites(adminAuth);
      setInviteRows(rows);
      setInviteState({ status: "ready", message: `已读取 ${rows.length} 个邀请码。` });
    } catch (caught) {
      setInviteState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function createInvite() {
    if (!adminReady || inviteState.status === "loading") {
      setInviteState({ status: "error", message: "请先登录管理员账号，或在首个管理员初始化时填写私有访问码。" });
      return;
    }
    setInviteState({ status: "loading", message: "正在生成邀请码..." });
    try {
      const created = await createAdminInvite(
        {
          email: inviteEmail,
          role: inviteRole,
          maxWallets: Number(inviteMaxWallets) || 20,
          expiresInDays: Number(inviteExpiresInDays) || 14,
        },
        adminAuth,
      );
      setInviteEmail("");
      const rows = await listAdminInvites(adminAuth).catch(() => inviteRows);
      setInviteRows(rows);
      setInviteState({
        status: "ready",
        message: `${created.invite.role === "admin" ? "管理员" : "用户"}邀请码已生成，只展示这一次。`,
        code: created.code,
      });
    } catch (caught) {
      setInviteState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function refreshUsers() {
    if (!adminReady) {
      setUserState({ status: "error", message: "请先登录管理员账号，或在首个管理员初始化时填写私有访问码。" });
      return;
    }
    setUserState({ status: "loading", message: "正在读取用户列表..." });
    try {
      const rows = await listAdminUsers(adminAuth);
      setUserRows(rows);
      setUserQuotaDrafts(Object.fromEntries(rows.map((row) => [row.id, String(row.maxWallets || "")])));
      setUserState({ status: "ready", message: `已读取 ${rows.length} 个用户。` });
    } catch (caught) {
      setUserState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function saveUserQuota(row: AdminUserProfile) {
    if (!adminReady || userState.status === "loading") return;
    const maxWallets = Number(userQuotaDrafts[row.id]);
    if (!Number.isInteger(maxWallets) || maxWallets < 1 || maxWallets > 500) {
      setUserState({ status: "error", message: "钱包上限必须是 1 到 500 的整数。" });
      return;
    }
    setUserState({ status: "loading", message: "正在更新钱包上限..." });
    try {
      const updated = await updateAdminUser({ userId: row.id, maxWallets }, adminAuth);
      setUserRows((rows) => rows.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setUserQuotaDrafts((drafts) => ({ ...drafts, [updated.id]: String(updated.maxWallets || "") }));
      setUserState({ status: "ready", message: "钱包上限已更新。" });
      void refreshUsers();
    } catch (caught) {
      setUserState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function toggleUserStatus(row: AdminUserProfile) {
    if (!adminReady || userState.status === "loading") return;
    const nextStatus = row.status === "active" ? "disabled" : "active";
    if (nextStatus === "disabled" && row.id === authSession?.user.id) {
      setUserState({ status: "error", message: "不能禁用当前登录的管理员账号。" });
      return;
    }
    if (nextStatus === "disabled" && !window.confirm(`确认禁用 ${row.email}？禁用后该账号不能扫描或同步归档。`)) return;
    setUserState({ status: "loading", message: nextStatus === "active" ? "正在启用用户..." : "正在禁用用户..." });
    try {
      const updated = await updateAdminUser({ userId: row.id, status: nextStatus }, adminAuth);
      setUserRows((rows) => rows.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setUserState({ status: "ready", message: nextStatus === "active" ? "用户已启用。" : "用户已禁用。" });
      void refreshUsers();
    } catch (caught) {
      setUserState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function revokeInvite(id: string) {
    if (!adminReady || inviteState.status === "loading") return;
    if (!window.confirm("确认撤销这个未使用的邀请码？")) return;
    setInviteState({ status: "loading", message: "正在撤销邀请码..." });
    try {
      const revoked = await revokeAdminInvite(id, adminAuth);
      setInviteRows((rows) => rows.map((row) => (row.id === revoked.id ? revoked : row)));
      setInviteState({ status: "ready", message: "邀请码已撤销。" });
    } catch (caught) {
      setInviteState({ status: "error", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  function updateInviteRole(role: "admin" | "user") {
    setInviteRole(role);
    setInviteMaxWallets((current) => {
      if (role === "admin" && (!current || current === "20")) return "200";
      if (role === "user" && current === "200") return "20";
      return current;
    });
  }

  return (
    <section className="work-page">
      <PageHeader
        icon={Settings}
        title="偏好设置"
        eyebrow="只保留会影响达标判断的设置"
        description="分组管理、提醒任务这类暂时不影响主流程的页面先不展开，避免把核心工作流变复杂。"
      />

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-title">
            <Gauge size={18} />
            <h2>达标目标</h2>
          </div>
          <label className="target-input-control">
            <span>单钱包 10 日累计目标</span>
            <input
              type="number"
              min="0"
              step="1"
              value={tenDayTargetText}
              onChange={(event) => onTenDayTargetChange(event.target.value)}
              placeholder={DEFAULT_TEN_DAY_TARGET}
            />
            <small>当前等效日均 {targetTotal ? formatUsd(targetTotal / 10) : "--"}。</small>
          </label>
          <div className="settings-stat-grid">
            <MetricLine label="钱包数" value={String(portfolio.totalWallets)} />
            <MetricLine label="总目标" value={targetTotal ? formatUsd(targetTotal * portfolio.totalWallets) : "--"} />
            <MetricLine label="达成率" value={targetTotal ? `${formatNumber(portfolio.targetRate, 1)}%` : "--"} />
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-title">
            <ShieldCheck size={18} />
            <h2>本地归档</h2>
          </div>
          <div className="settings-stat-grid">
            <MetricLine label="扫描记录" value={String(scanHistoryCount)} />
            <MetricLine label="已归档钱包" value={String(portfolio.archivedWallets)} />
            <MetricLine label="待处理钱包" value={String(portfolio.pendingWallets)} />
          </div>
        </section>

        <section className="settings-card notification-settings-card">
          <div className="settings-card-title">
            <Send size={18} />
            <h2>飞书通知</h2>
          </div>

          <div className="notification-settings-top">
            <label className="notification-toggle">
              <input
                type="checkbox"
                checked={feishuEnabled}
                onChange={(event) => setFeishuEnabled(event.target.checked)}
                disabled={!authSession || notificationBusy}
              />
              <span>
                <strong>启用账号级自动提醒</strong>
                <small>手动风险提醒、真实数据测试和每日 Cron 都只使用当前登录账号的配置。</small>
              </span>
            </label>
            <div className={notificationSettings?.feishuConfigured ? "notification-status-pill ready" : "notification-status-pill"}>
              {notificationSettings?.feishuConfigured ? "已保存 Webhook" : "未保存 Webhook"}
            </div>
          </div>

          <div className="notification-form-grid">
            <label>
              <span>飞书机器人 Webhook</span>
              <input
                type="password"
                value={feishuWebhook}
                onChange={(event) => setFeishuWebhook(event.target.value)}
                placeholder={
                  notificationSettings?.feishuConfigured
                    ? `${notificationSettings.feishuWebhookMasked}，留空不修改`
                    : "https://open.feishu.cn/open-apis/bot/v2/hook/..."
                }
                disabled={!authSession || notificationBusy}
                autoComplete="off"
              />
            </label>
            <label>
              <span>签名密钥</span>
              <input
                type="password"
                value={feishuSecret}
                onChange={(event) => setFeishuSecret(event.target.value)}
                placeholder={notificationSettings?.feishuSecretConfigured ? "已保存，留空不修改" : "未启用签名可留空"}
                disabled={!authSession || notificationBusy}
                autoComplete="off"
              />
            </label>
            <label>
              <span>预测未来天数</span>
              <input
                type="number"
                min="0"
                max="30"
                value={notifyFutureDays}
                onChange={(event) => setNotifyFutureDays(event.target.value)}
                disabled={!authSession || notificationBusy}
              />
            </label>
          </div>

          <div className="invite-admin-actions">
            <button type="button" onClick={saveNotificationSettings} disabled={!authSession || notificationBusy}>
              保存飞书配置
            </button>
            <button
              type="button"
              onClick={sendNotificationTest}
              disabled={!authSession || notificationBusy || !notificationSettings?.feishuConfigured || !feishuEnabled}
            >
              发送真实数据测试
            </button>
            <button type="button" onClick={refreshNotificationSettings} disabled={!authSession || notificationBusy}>
              刷新配置
            </button>
            <button type="button" className="danger-action" onClick={clearNotificationSettings} disabled={!authSession || notificationBusy}>
              清除配置
            </button>
          </div>

          <p className={`invite-admin-message ${notificationState.status}`}>
            {authSession ? notificationState.message || "保存 Webhook 后，风险提醒会按账号隔离。" : "登录账号后配置飞书通知。"}
          </p>
        </section>

        <section className="settings-card invite-admin-card">
          <div className="settings-card-title">
            <LockKeyhole size={18} />
            <h2>邀请码管理</h2>
          </div>

          <label className="target-input-control">
            <span>管理员权限</span>
            <input
              type="password"
              value={accessPassword}
              onChange={(event) => onAccessPasswordChange(event.target.value)}
              placeholder={isAdminSession ? "已登录管理员账号，可留空" : "首个管理员初始化时填写"}
              autoComplete="current-password"
              disabled={isAdminSession}
            />
            <small>
              当前使用{adminModeLabel}。私有访问码只用于首个管理员初始化；之后请用管理员账号管理邀请。
            </small>
          </label>

          <div className="invite-form-grid">
            <label>
              <span>绑定邮箱</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="可留空"
                autoComplete="off"
              />
            </label>
            <label>
              <span>账号角色</span>
              <select value={inviteRole} onChange={(event) => updateInviteRole(event.target.value as "admin" | "user")}>
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label>
              <span>钱包上限</span>
              <input
                type="number"
                min="1"
                max="500"
                value={inviteMaxWallets}
                onChange={(event) => setInviteMaxWallets(event.target.value)}
              />
            </label>
            <label>
              <span>邀请码有效期</span>
              <input
                type="number"
                min="1"
                max="365"
                value={inviteExpiresInDays}
                onChange={(event) => setInviteExpiresInDays(event.target.value)}
              />
            </label>
          </div>

          <div className="invite-admin-actions">
            <button type="button" onClick={createInvite} disabled={!adminReady || inviteState.status === "loading"}>
              生成邀请码
            </button>
            <button type="button" onClick={refreshInvites} disabled={!adminReady || inviteState.status === "loading"}>
              刷新列表
            </button>
          </div>

          {inviteState.code && (
            <div className="invite-code-box">
              <span>新邀请码</span>
              <strong>{inviteState.code}</strong>
              <small>请立即发给用户；刷新后不会再显示原文。</small>
            </div>
          )}

          {inviteState.message && <p className={`invite-admin-message ${inviteState.status}`}>{inviteState.message}</p>}
        </section>

        <section className="settings-card invite-list-card">
          <div className="settings-card-title">
            <ClipboardList size={18} />
            <h2>最近邀请码</h2>
          </div>
          <div className="invite-list">
            {inviteRows.map((invite) => {
              const status = inviteStatus(invite);
              return (
                <article className="invite-row" key={invite.id}>
                  <div>
                    <strong>{invite.email || "未绑定邮箱"}</strong>
                    <span>
                      {formatSavedAt(invite.createdAt)} 创建 · 上限 {invite.maxWallets} 个钱包 ·{" "}
                      {invite.role === "admin" ? "管理员" : "普通用户"}
                    </span>
                  </div>
                  <em className={status.tone}>{status.label}</em>
                  <small>到期 {formatDateTime(invite.expiresAt)}</small>
                  <button
                    type="button"
                    onClick={() => revokeInvite(invite.id)}
                    disabled={!adminReady || status.tone !== "active" || inviteState.status === "loading"}
                  >
                    撤销
                  </button>
                </article>
              );
            })}
            {inviteRows.length === 0 && <div className="empty-detail-state">填写私有访问码后刷新列表。</div>}
          </div>
        </section>

        <section className="settings-card user-list-card">
          <div className="settings-card-title">
            <UserCircle size={18} />
            <h2>用户管理</h2>
          </div>
          <div className="invite-admin-actions">
            <button type="button" onClick={refreshUsers} disabled={!adminReady || userState.status === "loading"}>
              刷新用户
            </button>
          </div>
          {userState.message && <p className={`invite-admin-message ${userState.status}`}>{userState.message}</p>}
          <div className="user-list">
            {userRows.map((user) => {
              const isSelf = user.id === authSession?.user.id;
              const quotaValue = userQuotaDrafts[user.id] ?? String(user.maxWallets || "");
              return (
                <article className="user-row" key={user.id}>
                  <div>
                    <strong>{user.email || shortHash(user.id)}</strong>
                    <span>
                      {user.role === "admin" ? "管理员" : "普通用户"} · {formatSavedAt(user.createdAt)} 创建
                    </span>
                    <small>{user.workspaceCount} 个工作区 · 钱包 {user.walletCount}/{user.maxWallets || "--"}</small>
                  </div>
                  <em className={user.status}>{user.status === "active" ? "启用" : "禁用"}</em>
                  <label>
                    <span>钱包上限</span>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={quotaValue}
                      onChange={(event) => setUserQuotaDrafts((drafts) => ({ ...drafts, [user.id]: event.target.value }))}
                    />
                  </label>
                  <button type="button" onClick={() => saveUserQuota(user)} disabled={!adminReady || userState.status === "loading"}>
                    保存上限
                  </button>
                  <button
                    type="button"
                    className={user.status === "active" ? "danger-action" : ""}
                    onClick={() => toggleUserStatus(user)}
                    disabled={!adminReady || userState.status === "loading" || (isSelf && user.status === "active")}
                  >
                    {user.status === "active" ? "禁用" : "启用"}
                  </button>
                </article>
              );
            })}
            {userRows.length === 0 && <div className="empty-detail-state">登录管理员账号后刷新用户列表。</div>}
          </div>
        </section>
      </div>
    </section>
  );
}

function PageHeader({
  icon: Icon,
  title,
  eyebrow,
  description,
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  description: string;
}) {
  return (
    <header className="page-header">
      <div className="page-header-icon">
        <Icon size={20} />
      </div>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function MetricPanel({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <article className={`metric-panel ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function WalletDetailDrawer({
  record,
  bonusRules,
  onBonusRulesChange,
  onRefresh,
  onForceScan,
  onRename,
  disabled,
  onClose,
}: {
  record: WalletArchiveRecord;
  bonusRules: string;
  onBonusRulesChange: (value: string) => void;
  onRefresh: () => void;
  onForceScan: () => void;
  onRename: () => void;
  disabled: boolean;
  onClose: () => void;
}) {
  const [detailTab, setDetailTab] = useState<DetailTab>("daily");
  if (!record.result) return null;
  const result = record.result;
  const bonusRows = buildTokenBonusRows(result, bonusRules, record.address);
  const warnings = visibleWarnings(result.warnings);
  const countedSwaps = result.swaps.filter((swap) => swap.status === "counted");
  const partialSwaps = result.swaps.filter((swap) => swap.status === "partial");
  const maxDailyBoost = Math.max(1, ...result.dailyRows.map((row) => row.boostVolume));
  const detailTabs: Array<{ id: DetailTab; label: string; meta: string }> = [
    { id: "daily", label: "每日数据", meta: `${result.dailyRows.length} 天` },
    { id: "bonus", label: "代币加成", meta: `${bonusRows.length} 项` },
    { id: "tx", label: "交易明细", meta: `${result.swaps.length} 笔` },
  ];

  return (
    <div className="drawer-layer">
      <button type="button" className="drawer-scrim" onClick={onClose} aria-label="关闭详情背景" />
      <aside className="detail-drawer" tabIndex={0} aria-label="钱包详情">
        <div className="drawer-header">
          <div>
            <h2>{walletDisplayName(record)} 详情</h2>
            <span>
              {shortAddress(record.address)} · {result.windowStart} 至 {result.windowEnd} · {formatSavedAt(record.savedAt)} · {discoverySourceLabel(result.txDiscoverySource)}
            </span>
          </div>
          <div className="drawer-header-actions">
            <button type="button" className="drawer-rename-button" onClick={onRename}>
              重命名
            </button>
            <button type="button" className="drawer-refresh-button" onClick={onRefresh} disabled={disabled}>
              <RefreshCcw size={15} />
              刷新该钱包
            </button>
            <button type="button" className="drawer-rescan-button" onClick={onForceScan} disabled={disabled}>
              <RefreshCcw size={15} />
              重扫
            </button>
            <button type="button" className="drawer-close-button" onClick={onClose} title="关闭详情">
              <X size={19} />
            </button>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="warning-box compact-warning">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}

        <div className="drawer-summary-grid">
          <article>
            <span>10 日合计</span>
            <strong>{formatUsd(result.totalBoostVolume)}</strong>
          </article>
          <article>
            <span>10 日平均</span>
            <strong>{formatUsd(result.averageBoostVolume)}</strong>
          </article>
          <article>
            <span>有效交易</span>
            <strong>{countedSwaps.length}</strong>
          </article>
          <article>
            <span>加成项</span>
            <strong>{bonusRows.length}</strong>
          </article>
        </div>

        <div className="drawer-tabs" role="tablist" aria-label="钱包详情视图">
          {detailTabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={detailTab === tab.id ? "active" : ""}
              role="tab"
              aria-selected={detailTab === tab.id}
              onClick={() => setDetailTab(tab.id)}
            >
              {tab.label}
              <span>{tab.meta}</span>
            </button>
          ))}
        </div>

        <div className="detail-tab-panel">
          {detailTab === "daily" && (
            <section className="drawer-section" id="daily-data">
              <div className="drawer-section-title">
                <div>
                  <h3>每日数据</h3>
                  <span>
                    UTC0 · {result.windowStart} 至 {result.windowEnd}
                  </span>
                </div>
                <strong>{result.dailyRows.length} 天</strong>
              </div>
              <div className="daily-ledger" role="region" aria-label="每日数据列表" tabIndex={0}>
                {result.dailyRows.map((row) => (
                  <article className={row.txCount > 0 ? "daily-row has-volume" : "daily-row"} key={row.date}>
                    <div className="daily-date">
                      <time dateTime={row.date}>{row.date}</time>
                      <span>{row.txCount > 0 ? `${row.txCount} 笔有效交易` : "无有效交易"}</span>
                    </div>
                    <div className="daily-meter" aria-label={`${row.date} Boost ${formatUsd(row.boostVolume)}`}>
                      <span style={{ width: `${dailyBoostPercent(row.boostVolume, maxDailyBoost)}%` }} />
                    </div>
                    <div className="daily-values">
                      <strong>{formatUsd(row.boostVolume)}</strong>
                      <span>成交额 {formatUsd(row.tradeUsd, true)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {detailTab === "bonus" && (
            <section className="drawer-section" id="token-bonus">
              <div className="drawer-section-title">
                <div>
                  <h3>代币额外加成</h3>
                  <span>本地试算，修改后总览和明细会立即重算</span>
                </div>
                <strong>{bonusRows.length} 项</strong>
              </div>
              {bonusRows.length > 0 ? (
                <div className="bonus-card-grid" role="region" aria-label="代币额外加成列表" tabIndex={0}>
                  {bonusRows.map((row) => (
                    <article className="token-bonus-card" key={`${row.date}:${row.address}`}>
                      <div className="token-bonus-header">
                        <div className="bonus-token">
                          <strong>{row.symbol}</strong>
                          <small>{shortAddress(row.address)}</small>
                        </div>
                        <span className={row.percentInput ? "bonus-value-pill active" : "bonus-value-pill"}>
                          {row.percentInput ? `+${row.percentInput}%` : "无额外加成"}
                        </span>
                      </div>
                      <div className="token-bonus-meta">
                        <span>{row.groupLabel}</span>
                        <span>{row.date}</span>
                        <span>{row.txCount} 笔相关交易</span>
                      </div>
                      <div className="bonus-controls">
                        <label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.percentInput}
                            onChange={(event) =>
                              onBonusRulesChange(
                                updateBonusRuleText(bonusRules, record.address, row.date, row.address, event.target.value),
                              )
                            }
                          />
                          <span>%</span>
                        </label>
                        <div className="bonus-presets">
                          {[0, 25, 50, 100].map((percent) => (
                            <button
                              type="button"
                              key={percent}
                              className={Number(row.percentInput || 0) === percent ? "active" : ""}
                              onClick={() =>
                                onBonusRulesChange(
                                  updateBonusRuleText(bonusRules, record.address, row.date, row.address, String(percent)),
                                )
                              }
                            >
                              {percent === 0 ? "无" : `+${percent}%`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-detail-state">当前窗口没有可设置加成的代币日期项。</div>
              )}
            </section>
          )}

          {detailTab === "tx" && (
            <section className="drawer-section" id="tx-details">
              <div className="drawer-section-title">
                <div>
                  <h3>交易明细</h3>
                  <span>
                    有效 {countedSwaps.length} · 部分 {partialSwaps.length} · 全部 {result.swaps.length}
                  </span>
                </div>
                <strong>{formatUsd(result.totalTradeUsd, true)}</strong>
              </div>
              <div className="table-scroll detail-table-scroll" role="region" aria-label="交易明细表格" tabIndex={0}>
                <table className="compact-table tx-table">
                  <thead>
                    <tr>
                      <th>Hash</th>
                      <th>日期</th>
                      <th>状态</th>
                      <th>交易对</th>
                      <th>成交额</th>
                      <th>倍数</th>
                      <th>Boost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.swaps.map((swap) => (
                      <tr key={swap.hash}>
                        <td>
                          <a href={`${BSC_CHAIN.explorerTxUrl}${swap.hash}`} target="_blank" rel="noreferrer">
                            {shortHash(swap.hash)}
                            <ExternalLink size={13} />
                          </a>
                        </td>
                        <td>{swap.utcDate}</td>
                        <td>
                          <span className={`swap-status ${swap.status}`}>{swapStatusLabel(swap.status)}</span>
                        </td>
                        <td>
                          {swap.inputToken.symbol} → {swap.outputToken.symbol}
                        </td>
                        <td>
                          {formatUsd(swap.tradeUsd, true)}
                          <small>{swap.usdBasis}</small>
                        </td>
                        <td>
                          {formatNumber(swap.baseMultiplier, 2)}×
                          <small>额外 {formatBonusPercent(swap.bonusMultiplier)}</small>
                        </td>
                        <td>
                          {formatUsd(swap.boostVolume)}
                          {swap.reason && <small>{swap.reason}</small>}
                        </td>
                      </tr>
                    ))}
                    {result.swaps.length === 0 && (
                      <tr>
                        <td colSpan={7} className="empty-row">
                          没有解析到窗口内的 OKX Boost 交易
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function dailyBoostPercent(boostVolume: number, maxDailyBoost: number): number {
  if (boostVolume <= 0 || maxDailyBoost <= 0) return 0;
  return Math.max(3, Math.min(100, (boostVolume / maxDailyBoost) * 100));
}

function swapStatusLabel(status: "counted" | "excluded" | "partial"): string {
  if (status === "counted") return "有效";
  if (status === "partial") return "部分";
  return "排除";
}

function buildPortfolioSummary(
  records: WalletArchiveRecord[],
  endDate: string,
  targetTotalPerWallet: number | null,
): PortfolioSummary {
  let averageBoostVolume = 0;
  let totalBoostVolume = 0;
  let todayBoostVolume = 0;
  let countedTxCount = 0;
  let archivedWallets = 0;
  let runningWallets = 0;
  let pendingWallets = 0;
  let failedWallets = 0;

  for (const record of records) {
    if (record.state === "running") runningWallets += 1;
    if (record.state === "error") failedWallets += 1;
    if (!record.result && record.state !== "running" && record.state !== "error") pendingWallets += 1;
    if (!record.result) continue;
    archivedWallets += 1;
    averageBoostVolume += record.result.averageBoostVolume;
    totalBoostVolume += record.result.totalBoostVolume;
    todayBoostVolume += record.result.dailyRows.find((row) => row.date === endDate)?.boostVolume || 0;
    countedTxCount += record.result.swaps.filter((swap) => swap.status === "counted").length;
  }

  const targetTotal = targetTotalPerWallet === null ? 0 : targetTotalPerWallet * records.length;
  const targetGap = targetTotalPerWallet === null ? 0 : targetTotal - totalBoostVolume;
  const targetRate = targetTotal > 0 ? (totalBoostVolume / targetTotal) * 100 : 0;
  return {
    totalWallets: records.length,
    archivedWallets,
    runningWallets,
    pendingWallets,
    failedWallets,
    averageBoostVolume,
    totalBoostVolume,
    todayBoostVolume,
    countedTxCount,
    targetGap,
    targetRate,
  };
}

function buildPrimaryAction(
  records: WalletArchiveRecord[],
  portfolio: PortfolioSummary,
  anyRunning: boolean,
): PrimaryActionModel {
  if (records.length === 0) {
    return {
      kind: "manage-wallets",
      label: "去钱包管理",
      description: "先进入钱包管理页面添加地址",
    };
  }
  if (anyRunning) {
    return {
      kind: "running",
      label: `扫描中 ${portfolio.runningWallets}/${portfolio.totalWallets}`,
      description: "当前已有钱包在扫描，完成后再执行新操作",
      disabled: true,
    };
  }
  if (portfolio.failedWallets > 0) {
    return {
      kind: "retry-failed",
      label: "重试失败钱包",
      description: `${portfolio.failedWallets} 个钱包扫描失败，只重试失败项`,
    };
  }
  if (portfolio.pendingWallets > 0) {
    return {
      kind: "scan-pending",
      label: "扫描待处理钱包",
      description: `${portfolio.pendingWallets} 个钱包还没有归档结果`,
    };
  }
  return {
    kind: "refresh-all",
    label: "刷新新增交易",
    description: "只补扫归档之后的新区块，不重复完整扫描",
  };
}

function overviewDecisionText(
  portfolio: PortfolioSummary,
  targetTotalPerWallet: number | null,
  primaryAction: PrimaryActionModel,
): string {
  if (primaryAction.kind === "manage-wallets") return "先到钱包管理页面添加地址。";
  if (primaryAction.kind === "running") return "正在扫描钱包，保留当前结果并等待完成。";
  if (primaryAction.kind === "retry-failed") return `${portfolio.failedWallets} 个钱包失败，建议先重试失败钱包。`;
  if (primaryAction.kind === "scan-pending") return `${portfolio.pendingWallets} 个钱包尚未扫描，先完成归档再判断是否达标。`;
  if (!targetTotalPerWallet) return "填写 10 日累计目标后显示达标差额。";
  if (portfolio.targetGap > 0) return `还差 ${formatUsd(portfolio.targetGap)}，优先刷新新增交易。`;
  if (portfolio.targetGap < 0) return `已超出目标 ${formatUsd(Math.abs(portfolio.targetGap))}，保持归档即可。`;
  return "刚好达到目标，继续保持当前归档。";
}

function buildSnapshotForecastRows(
  records: WalletArchiveRecord[],
  baseSnapshotDate: string,
  targetTotalPerWallet: number | null,
): SnapshotForecastRow[] {
  if (!isUtcDate(baseSnapshotDate)) return [];
  return Array.from({ length: 4 }, (_, offset) => {
    const snapshotDate = addUtcDays(baseSnapshotDate, offset);
    const { days } = buildUtcWindow(snapshotDate);
    const daySet = new Set(days);
    const expiredDate = addUtcDays(snapshotDate, -10);
    const walletRows = records
      .map((record, index) => {
        if (!record.result) return null;
        const boostVolume = record.result.dailyRows.reduce(
          (sum, row) => (daySet.has(row.date) ? sum + row.boostVolume : sum),
          0,
        );
        const expiredBoostVolume = record.result.dailyRows.find((row) => row.date === expiredDate)?.boostVolume || 0;
        const gap = targetTotalPerWallet === null ? 0 : Math.max(0, targetTotalPerWallet - boostVolume);
        return {
          address: record.address,
          name: walletDisplayName(record, index),
          boostVolume,
          gap,
          expiredBoostVolume,
          targetMet: targetTotalPerWallet !== null && boostVolume >= targetTotalPerWallet,
        };
      })
      .filter((row): row is SnapshotForecastWalletRow => Boolean(row))
      .sort((a, b) => {
        if (a.targetMet !== b.targetMet) return a.targetMet ? 1 : -1;
        if (b.gap !== a.gap) return b.gap - a.gap;
        return a.boostVolume - b.boostVolume;
      });

    const archivedWallets = walletRows.length;
    const atRiskWallets = targetTotalPerWallet === null ? 0 : walletRows.filter((row) => !row.targetMet).length;
    const targetMetWallets = targetTotalPerWallet === null ? 0 : archivedWallets - atRiskWallets;
    const totalBoostVolume = walletRows.reduce((sum, row) => sum + row.boostVolume, 0);
    const expiredBoostVolume = walletRows.reduce((sum, row) => sum + row.expiredBoostVolume, 0);
    const worstGap = walletRows.reduce((max, row) => Math.max(max, row.gap), 0);

    return {
      snapshotDate,
      runLabel: `${formatToolbarDate(addUtcDays(snapshotDate, 1))} ${SNAPSHOT_CONFIRM_TIME_LABEL}`,
      windowStart: days[0],
      windowEnd: days[days.length - 1],
      expiredDate,
      archivedWallets,
      targetMetWallets,
      atRiskWallets,
      totalBoostVolume,
      expiredBoostVolume,
      worstGap,
      walletRows,
    };
  });
}

function buildFeishuForecastMessage(row: SnapshotForecastRow, targetTotalPerWallet: number): string {
  const riskWallets = row.walletRows
    .filter((wallet) => !wallet.targetMet)
    .slice(0, 8)
    .map(
      (wallet, index) =>
        `${index + 1}. ${wallet.name} ${shortAddress(wallet.address)}：当前 ${formatUsd(wallet.boostVolume)}，差 ${formatUsd(wallet.gap)}`,
    );

  return [
    "OKX Boost 日结快照预警",
    `确认时间：${row.runLabel} 北京时间`,
    `快照日：${row.snapshotDate}`,
    `统计窗口：${row.windowStart} 至 ${row.windowEnd}`,
    `单钱包目标：${formatUsd(targetTotalPerWallet)}`,
    `风险钱包：${row.atRiskWallets}/${row.archivedWallets}`,
    `最大差额：${formatUsd(row.worstGap)}`,
    `到期交易量：${formatUsd(row.expiredBoostVolume)}`,
    "",
    "需要处理的钱包：",
    riskWallets.length ? riskWallets.join("\n") : "暂无",
  ].join("\n");
}

function buildDailyPortfolioRows(records: WalletArchiveRecord[]): DailyPortfolioRow[] {
  const rows = new Map<string, DailyPortfolioRow>();
  for (const record of records) {
    if (!record.result) continue;
    for (const row of record.result.dailyRows) {
      const existing = rows.get(row.date) || { date: row.date, boostVolume: 0, tradeUsd: 0, txCount: 0 };
      existing.boostVolume += row.boostVolume;
      existing.tradeUsd += row.tradeUsd;
      existing.txCount += row.txCount;
      rows.set(row.date, existing);
    }
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function buildWalletRankingRows(
  records: WalletArchiveRecord[],
  endDate: string,
  targetTotal: number | null,
): WalletRankingRow[] {
  return records
    .map((record, index) => {
      if (!record.result) return null;
      const todayBoostVolume = record.result.dailyRows.find((row) => row.date === endDate)?.boostVolume || 0;
      const countedTxCount = record.result.swaps.filter((swap) => swap.status === "counted").length;
      return {
        address: record.address,
        name: walletDisplayName(record, index),
        totalBoostVolume: record.result.totalBoostVolume,
        averageBoostVolume: record.result.averageBoostVolume,
        todayBoostVolume,
        countedTxCount,
        targetDelta: targetTotal === null ? null : record.result.totalBoostVolume - targetTotal,
      };
    })
    .filter((row): row is WalletRankingRow => Boolean(row))
    .sort((a, b) => {
      if (a.targetDelta !== null && b.targetDelta !== null && a.targetDelta !== b.targetDelta) {
        return a.targetDelta - b.targetDelta;
      }
      return b.totalBoostVolume - a.totalBoostVolume;
    });
}

function buildSourceBreakdownRows(records: WalletArchiveRecord[]): SourceBreakdownRow[] {
  const rows = new Map<string, SourceBreakdownRow>();
  for (const record of records) {
    if (!record.result) continue;
    const source = record.result.txDiscoverySource || "archive";
    const label = discoverySourceLabel(source);
    const existing = rows.get(label) || {
      source,
      label,
      walletCount: 0,
      boostVolume: 0,
    };
    existing.walletCount += 1;
    existing.boostVolume += record.result.totalBoostVolume;
    rows.set(label, existing);
  }
  return [...rows.values()].sort((a, b) => b.boostVolume - a.boostVolume);
}

function buildArchiveHistoryRecords(records: WalletArchiveRecord[], endDate: string): ScanHistoryRecord[] {
  return records
    .filter((record) => record.result && record.savedAt)
    .map((record) => ({
      id: `archive:${record.address}:${endDate}:${record.savedAt}`,
      address: record.address,
      snapshotDate: endDate,
      mode: "archive" as const,
      status: "success" as const,
      startedAt: record.savedAt || "",
      endedAt: record.savedAt || "",
      durationMs: 0,
      source: record.source === "archive" ? "archive" : record.result?.txDiscoverySource,
      scannedFromBlock: record.result?.scannedFromBlock,
      scannedToBlock: record.result?.scannedToBlock,
      incrementalFromBlock: record.result?.incrementalFromBlock,
      newTxCount: record.result?.incrementalNewTxCount,
      totalTxCount: record.result?.swaps.length,
      warningCount: visibleWarnings(record.result?.warnings || []).length,
    }))
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
}

function filterWalletRecords(records: WalletArchiveRecord[], filter: WalletFilter): WalletArchiveRecord[] {
  if (filter === "archived") return records.filter((record) => Boolean(record.result));
  if (filter === "running") return records.filter((record) => record.state === "running");
  if (filter === "pending") return records.filter((record) => !record.result && record.state !== "running" && record.state !== "error");
  if (filter === "error") return records.filter((record) => record.state === "error");
  return records;
}

function formatBonusPercent(multiplier: number): string {
  const percent = (multiplier - 1) * 100;
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${formatNumber(percent, 0)}%`;
}

type TokenBonusRow = {
  address: string;
  date: string;
  symbol: string;
  groupLabel: string;
  txCount: number;
  percentInput: string;
};

function buildTokenBonusRows(result: CalculationResult, bonusRules: string, walletAddress: string): TokenBonusRow[] {
  const bonuses = parseScopedBonusRules(bonusRules);
  const wallet = normalizeAddress(walletAddress);
  const rows = new Map<string, { date: string; token: TokenMeta; txHashes: Set<string> }>();

  for (const swap of result.swaps) {
    for (const token of [swap.inputToken, swap.outputToken]) {
      const address = normalizeAddress(token.address);
      const rowKey = [swap.utcDate, address].join("|");
      if (!rows.has(rowKey)) rows.set(rowKey, { date: swap.utcDate, token, txHashes: new Set() });
      rows.get(rowKey)?.txHashes.add(swap.hash);
    }
  }

  return [...rows.values()]
    .map((row) => {
      const address = normalizeAddress(row.token.address);
      return {
        address,
        date: row.date,
      symbol: row.token.symbol,
      groupLabel: tokenGroupLabel(row.token.group),
      txCount: row.txHashes.size,
        percentInput: multiplierToPercentInput(scopedBonusFor(bonuses, wallet, row.date, address)),
      group: row.token.group,
      };
    })
    .sort((a, b) => {
      const groupOrder: Record<TokenGroup, number> = { group1: 0, group2: 1, other: 2 };
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (groupOrder[a.group] !== groupOrder[b.group]) return groupOrder[a.group] - groupOrder[b.group];
      if (b.txCount !== a.txCount) return b.txCount - a.txCount;
      return a.symbol.localeCompare(b.symbol);
    });
}

function applyBonusRules(result: CalculationResult, bonusRules: string, walletAddress: string): CalculationResult {
  const bonuses = parseScopedBonusRules(bonusRules);
  const wallet = normalizeAddress(walletAddress);
  const swaps = result.swaps.map((swap) => {
    const bonusMultiplier = scopedBonusMultiplierForSwap(swap, bonuses, wallet);
    const boostVolume =
      swap.tradeUsd === undefined || swap.baseMultiplier === 0
        ? 0
        : swap.tradeUsd * swap.baseMultiplier * bonusMultiplier;
    return {
      ...swap,
      bonusMultiplier,
      boostVolume,
    };
  });

  const dailyRows = result.dailyRows.map((row) => ({
    ...row,
    txCount: 0,
    boostVolume: 0,
    tradeUsd: 0,
  }));
  const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));
  for (const swap of swaps) {
    const row = dailyMap.get(swap.utcDate);
    if (!row) continue;
    row.txCount += swap.status === "counted" ? 1 : 0;
    row.boostVolume += swap.boostVolume;
    row.tradeUsd += swap.tradeUsd || 0;
  }

  const totalBoostVolume = dailyRows.reduce((sum, row) => sum + row.boostVolume, 0);
  const totalTradeUsd = dailyRows.reduce((sum, row) => sum + row.tradeUsd, 0);

  return {
    ...result,
    averageBoostVolume: totalBoostVolume / 10,
    totalBoostVolume,
    totalTradeUsd,
    dailyRows,
    swaps,
  };
}

function parseWalletList(raw: string): ParsedWalletList {
  const seen = new Set<string>();
  const entries: WalletListEntry[] = [];
  const invalid: string[] = [];
  let duplicateCount = 0;

  for (const rawLine of raw.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const matches = [...line.matchAll(ADDRESS_PATTERN)];
    if (matches.length === 0) {
      for (const chunk of line.split(/[\s,，;；]+/)) {
        const candidate = chunk.trim();
        if (candidate) invalid.push(candidate);
      }
      continue;
    }

    for (const match of matches) {
      const address = match[0];
      const normalized = normalizeAddress(address);
      if (seen.has(normalized)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(normalized);
      entries.push({
        address: normalized,
        name: cleanWalletName(line.replace(ADDRESS_PATTERN, " ")),
      });
    }
  }

  return { entries, addresses: entries.map((entry) => entry.address), invalid, duplicateCount };
}

function syncWalletRecords(current: WalletArchiveRecord[], entries: WalletListEntry[], endDate: string): WalletArchiveRecord[] {
  const currentByAddress = new Map(current.map((record) => [record.address, record]));
  return entries.map(({ address, name }) => {
    const existing = currentByAddress.get(address);
    if (existing?.state === "running") return { ...existing, name };
    const persisted = readPersistedResult(address, endDate);
    if (persisted) {
      return {
        address,
        name,
        state: "done",
        source: "archive",
        result: persisted.result,
        progress: "已从本地归档恢复",
        error: "",
        savedAt: persisted.savedAt,
      };
    }
    if (existing && existing.result && existing.source === "fresh" && existing.result.windowEnd === endDate) {
      return { ...existing, name };
    }
    return {
      address,
      name,
      state: "idle",
      source: "empty",
      result: null,
      progress: "等待扫描",
      error: "",
    };
  });
}

function cleanWalletName(raw: string): string {
  return raw.replace(/[=：:|,，;；]+/g, " ").replace(/\s+/g, " ").trim();
}

function updateWalletNameInText(raw: string, address: string, nextNameRaw: string): string {
  const normalizedAddress = normalizeAddress(address);
  const nextName = cleanWalletName(nextNameRaw);
  const parsed = parseWalletList(raw);
  const entries = parsed.entries.map((entry) =>
    entry.address === normalizedAddress ? { ...entry, name: nextName } : entry,
  );
  if (!entries.some((entry) => entry.address === normalizedAddress)) {
    entries.push({ address: normalizedAddress, name: nextName });
  }
  return entries.map((entry) => (entry.name ? `${entry.name} ${entry.address}` : entry.address)).join("\n");
}

function scopedBonusMultiplierForSwap(swap: ParsedSwap, rules: ScopedBonusRules, wallet: string): number {
  const inputBonus = scopedBonusFor(rules, wallet, swap.utcDate, swap.inputToken.address);
  const outputBonus = scopedBonusFor(rules, wallet, swap.utcDate, swap.outputToken.address);
  return Math.max(inputBonus, outputBonus, 1);
}

function scopedBonusFor(rules: ScopedBonusRules, wallet: string, date: string, address: string): number {
  const token = normalizeAddress(address);
  return rules.scoped[scopedBonusKey(wallet, date, token)] || rules.global[token] || 1;
}

function scopedBonusKey(wallet: string, date: string, address: string): string {
  return [normalizeAddress(wallet), date, normalizeAddress(address)].join("|");
}

function parseScopedBonusRules(raw: string): ScopedBonusRules {
  const rules: ScopedBonusRules = { scoped: {}, global: {} };
  for (const line of raw.split(/\n|,/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [leftRaw, multiplierRaw] = trimmed.split(/=|:/).map((part) => part.trim());
    const multiplier = parseBonusMultiplierInput(multiplierRaw);
    if (!Number.isFinite(multiplier) || multiplier <= 0) continue;

    const parts = (leftRaw || "").split("|").map((part) => part.trim());
    if (parts.length === 3 && isAddress(parts[0]) && isUtcDate(parts[1]) && isAddress(parts[2])) {
      rules.scoped[scopedBonusKey(parts[0], parts[1], parts[2])] = multiplier;
      continue;
    }

    if (parts.length === 1 && isAddress(parts[0])) {
      rules.global[normalizeAddress(parts[0])] = multiplier;
    }
  }
  return rules;
}

function parseBonusMultiplierInput(value: string | undefined): number {
  const normalized = (value || "").trim().replace(/\s+/g, "");
  if (!normalized) return Number.NaN;

  if (normalized.endsWith("%")) {
    const percentage = Number(normalized.slice(0, -1).replace(/^\+/, ""));
    return Number.isFinite(percentage) ? 1 + percentage / 100 : Number.NaN;
  }

  if (normalized.startsWith("+")) {
    const percentage = Number(normalized.slice(1));
    return Number.isFinite(percentage) ? 1 + percentage / 100 : Number.NaN;
  }

  if (normalized.toLowerCase().endsWith("x")) return Number(normalized.slice(0, -1));

  const parsed = Number(normalized);
  return parsed > 10 ? 1 + parsed / 100 : parsed;
}

function updateBonusRuleText(raw: string, wallet: string, date: string, address: string, percentRaw: string): string {
  const normalizedWallet = normalizeAddress(wallet);
  const normalizedAddress = normalizeAddress(address);
  const targetKey = scopedBonusKey(normalizedWallet, date, normalizedAddress);
  const percent = Number(percentRaw);
  const lines = raw
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => bonusRuleIdentity(line.split(/=|:/)[0] || "") !== targetKey);

  if (Number.isFinite(percent) && percent > 0) {
    lines.push(`${normalizedWallet}|${date}|${normalizedAddress}=${formatPercentRule(percent)}%`);
  }

  return lines.join("\n");
}

function bonusRuleIdentity(leftRaw: string): string {
  const parts = leftRaw.split("|").map((part) => part.trim());
  if (parts.length === 3 && isAddress(parts[0]) && isUtcDate(parts[1]) && isAddress(parts[2])) {
    return scopedBonusKey(parts[0], parts[1], parts[2]);
  }
  if (parts.length === 1 && isAddress(parts[0])) return normalizeAddress(parts[0]);
  return leftRaw.trim();
}

function isUtcDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addUtcDays(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function multiplierToPercentInput(multiplier: number): string {
  const percent = (multiplier - 1) * 100;
  return percent > 0 ? formatPercentRule(percent) : "";
}

function formatPercentRule(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/\.?0+$/, "");
}

function tokenGroupLabel(group: TokenGroup): string {
  if (group === "group1") return "Group 1";
  if (group === "group2") return "Group 2";
  return "Other";
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function walletDisplayName(record: WalletArchiveRecord, index?: number): string {
  if (record.name) return record.name;
  if (typeof index === "number") return index === 0 ? "MyanDong" : `Wallet-${String(index + 1).padStart(2, "0")}`;
  return shortAddress(record.address);
}

function walletManagementStatus(record: WalletArchiveRecord): { label: string; tone: string } {
  if (record.result) return { label: "已归档", tone: "done" };
  if (record.state === "running") return { label: "扫描中", tone: "running" };
  if (record.state === "error") return { label: "失败", tone: "error" };
  return { label: "待扫描", tone: "pending" };
}

function walletNameLabel(address: string, walletNameByAddress: Map<string, string>): string {
  const name = walletNameByAddress.get(normalizeAddress(address));
  return name || shortAddress(address);
}

function lastScanLabel(record: WalletArchiveRecord): string {
  if (record.state === "running") return "进行中";
  if (record.state === "error") return "失败";
  if (typeof record.result?.incrementalNewTxCount === "number") {
    return `${discoverySourceLabel(record.result.txDiscoverySource)} · 新增 ${record.result.incrementalNewTxCount} 笔`;
  }
  if (record.result) return "成功";
  return "未开始";
}

function viewMetaFor(view: AppView, targetTotal: number | null): { title: string; subtitle: string } {
  if (view === "scan-records") {
    return {
      title: "OKX Boost 扫描记录",
      subtitle: "本地归档 · 增量刷新 · 强制重扫审计",
    };
  }
  if (view === "wallets") {
    return {
      title: "OKX Boost 钱包管理",
      subtitle: "钱包名称 · 地址 · 私有访问码",
    };
  }
  if (view === "reports") {
    return {
      title: "OKX Boost 统计报表",
      subtitle: `单钱包 10 日累计目标 ${targetTotal ? formatUsd(targetTotal) : "--"}`,
    };
  }
  if (view === "settings") {
    return {
      title: "OKX Boost 偏好设置",
      subtitle: "达标目标与本地归档管理",
    };
  }
  return {
    title: "OKX Boost 钱包总览",
    subtitle: "BNB Chain · 最近 10 天 Boost 交易归档",
  };
}

function discoverySourceLabel(source: CalculationResult["txDiscoverySource"]): string {
  if (source === "ankr") return "Ankr 索引";
  if (source === "explorer") return "Explorer 索引";
  if (source === "rpc") return "RPC 兜底";
  if (source === "import") return "导入记录";
  if (source === "archive") return "本地归档";
  return "已归档";
}

function scanModeFromOptions(options: ScanWalletOptions): ScanMode {
  if (options.forceRefresh) return "rescan";
  if (options.refresh) return "refresh";
  return "scan";
}

function scanModeLabel(mode: ScanMode): string {
  if (mode === "refresh") return "增量刷新";
  if (mode === "rescan") return "强制重扫";
  if (mode === "archive") return "归档记录";
  return "首次扫描";
}

function scanStatusLabel(record: ScanHistoryRecord): string {
  if (record.status === "success") return "成功";
  return record.error ? "失败" : "异常";
}

function blockRangeLabel(record: ScanHistoryRecord): string {
  if (record.scannedFromBlock && record.scannedToBlock) {
    return `${formatNumber(record.scannedFromBlock, 0)} - ${formatNumber(record.scannedToBlock, 0)}`;
  }
  if (record.scannedToBlock) return `至 ${formatNumber(record.scannedToBlock, 0)}`;
  return "--";
}

function formatDuration(durationMs: number): string {
  if (!durationMs) return "--";
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${formatNumber(seconds, 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
}

function targetGapLabel(gap: number): string {
  if (gap > 0) return `还差 ${formatUsd(gap)}`;
  if (gap < 0) return `超出 ${formatUsd(Math.abs(gap))}`;
  return formatUsd(0);
}

function formatToolbarDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}/${month}/${day}`;
}

function formatSavedAt(savedAt?: string): string {
  if (!savedAt) return "--";
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function inviteStatus(invite: AdminInvite): { label: string; tone: "active" | "used" | "expired" } {
  if (invite.usedAt) return { label: "已使用", tone: "used" };
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
    return { label: "已过期", tone: "expired" };
  }
  return { label: "可使用", tone: "active" };
}

function parseOptionalAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function visibleWarnings(warnings: string[]): string[] {
  return warnings.filter(
    (warning) =>
      !warning.startsWith("钱包交易记录索引读取失败") &&
      !warning.startsWith("Ankr Advanced API 读取失败"),
  );
}

function hydrateRecordsFromServerArchive(
  archive: ServerArchivePayload,
  walletsText: string,
  endDate: string,
): WalletArchiveRecord[] {
  const entries = parseWalletList(walletsText).entries;
  const recordsByAddress = new Map(
    (archive.records || [])
      .filter((record) => isAddress(record.address))
      .map((record) => [normalizeAddress(record.address), record]),
  );

  return entries.map((entry) => {
    const archived = recordsByAddress.get(entry.address);
    if (archived?.result && archived.result.windowEnd === endDate) {
      return {
        address: entry.address,
        name: entry.name || archived.name || "",
        state: "done",
        source: "archive",
        result: archived.result,
        progress: "已从服务端归档恢复",
        error: "",
        savedAt: archived.savedAt,
      };
    }
    if (archived?.result) {
      return {
        address: entry.address,
        name: entry.name || archived.name || "",
        state: "done",
        source: "archive",
        result: archived.result,
        progress: "服务端归档待刷新",
        error: "",
        savedAt: archived.savedAt,
      };
    }
    return {
      address: entry.address,
      name: entry.name,
      state: archived?.state === "error" ? "error" : "idle",
      source: "empty",
      result: null,
      progress: archived?.progress || "等待扫描",
      error: archived?.error || "",
      savedAt: archived?.savedAt,
    };
  });
}

function shouldSkipServerArchiveSync(
  walletsText: string,
  records: WalletArchiveRecord[],
  scanHistory: ScanHistoryRecord[],
): boolean {
  const addresses = parseWalletList(walletsText).addresses;
  const onlyDefaultSampleWallet = addresses.length === 1 && addresses[0] === normalizeAddress(SAMPLE_WALLET);
  const hasArchivedData = records.some((record) => record.result || record.savedAt);
  if (addresses.length === 0 && !hasArchivedData && scanHistory.length === 0) return true;
  return onlyDefaultSampleWallet && !hasArchivedData && scanHistory.length === 0;
}

async function syncServerArchive(params: {
  walletsText: string;
  endDate: string;
  tenDayTarget: string;
  boostOverrides: string;
  dataSpace: string;
  records: WalletArchiveRecord[];
  scanHistory: ScanHistoryRecord[];
  accessPassword: string;
  authSession: AuthSession | null;
}): Promise<{ ok: boolean; error?: string }> {
  const payload: ServerArchivePayload = {
    workspaceId: params.dataSpace,
    walletsText: params.walletsText,
    endDate: params.endDate,
    tenDayTarget: params.tenDayTarget,
    boostOverrides: params.boostOverrides,
    records: params.records.map((record) => ({
      address: record.address,
      name: record.name,
      state: record.state,
      source: record.source,
      result: record.result,
      progress: record.progress,
      error: record.error,
      savedAt: record.savedAt,
    })),
    scanHistory: params.scanHistory,
  };

  try {
    const response = await fetch("/api/archive", {
      method: "POST",
      headers: archiveAccessHeaders(params.accessPassword, params.dataSpace, { "content-type": "application/json" }, params.authSession),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorPayload.error || `HTTP ${response.status}`);
    }
    return { ok: true };
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    return { ok: false, error };
  }
}

function archiveAccessHeaders(
  accessPassword: string,
  dataSpace: string,
  headers: Record<string, string> = {},
  authSession: AuthSession | null = null,
): Record<string, string> {
  if (authSession) return authHeaders(authSession, headers);
  const password = accessPassword.trim();
  const workspace = normalizeDataSpace(dataSpace);
  const baseHeaders = password ? { ...headers, [ACCESS_HEADER]: password } : serverAccessHeaders(headers);
  return { ...baseHeaders, [WORKSPACE_HEADER]: workspace };
}

function mergeWalletTexts({
  localText,
  serverText,
  preserveLocal,
}: {
  localText: string;
  serverText: string;
  preserveLocal: boolean;
}): string {
  if (!serverText.trim()) return localText;
  if (!preserveLocal) return serverText;

  const localEntries = parseWalletList(localText).entries;
  const serverEntries = parseWalletList(serverText).entries;
  const merged = new Map<string, WalletListEntry>();
  for (const entry of serverEntries) merged.set(entry.address, entry);
  for (const entry of localEntries) {
    const serverEntry = merged.get(entry.address);
    merged.set(entry.address, {
      address: entry.address,
      name: entry.name || serverEntry?.name || "",
    });
  }
  return [...merged.values()].map((entry) => (entry.name ? `${entry.name} ${entry.address}` : entry.address)).join("\n");
}

function normalizeDataSpace(value: string): string {
  const normalized = value.trim().replace(/\s+/g, "-").slice(0, 80);
  return normalized || DEFAULT_DATA_SPACE;
}

function readPersistedUiState(): PersistedUiState {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const state = JSON.parse(storage.getItem(UI_STATE_KEY) || "{}") as PersistedUiState;
    const walletsText = isOnlyLegacySampleWallet(state.walletsText) ? "" : state.walletsText;
    const address = isOnlyLegacySampleWallet(state.address) ? "" : state.address;
    return {
      ...state,
      walletsText,
      address,
      walletFilter: isWalletFilter(state.walletFilter) ? state.walletFilter : "all",
      currentView: isAppView(state.currentView) ? state.currentView : "overview",
    };
  } catch {
    storage.removeItem(UI_STATE_KEY);
    return {};
  }
}

function isOnlyLegacySampleWallet(value: string | undefined): boolean {
  const entries = parseWalletList(String(value || "")).entries;
  return entries.length === 1 && entries[0].address === normalizeAddress(LEGACY_SAMPLE_WALLET);
}

function writePersistedUiState(state: PersistedUiState) {
  const storage = safeStorage();
  if (!storage) return;
  storage.setItem(UI_STATE_KEY, JSON.stringify(state));
}

function persistedResultKey(address: string, endDate: string): string {
  return [RESULT_CACHE_PREFIX, normalizeAddress(address), endDate].join(":");
}

function readPersistedResult(address: string, endDate: string): PersistedResultRecord | null {
  const storage = safeStorage();
  if (!storage || !address || !endDate) return null;
  try {
    const raw = storage.getItem(persistedResultKey(address, endDate));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedResultRecord | CalculationResult;
    if (isPersistedResultRecord(parsed)) return parsed;
    if (isCalculationResult(parsed)) return { result: parsed };
    return null;
  } catch {
    storage.removeItem(persistedResultKey(address, endDate));
    return null;
  }
}

function writePersistedResult(address: string, endDate: string, result: CalculationResult, savedAt: string) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(persistedResultKey(address, endDate), JSON.stringify({ result, savedAt }));
  } catch {
    // Persisted results are a convenience layer. Ignore quota failures.
  }
}

function clearPersistedResult(address: string, endDate: string) {
  const storage = safeStorage();
  if (!storage) return;
  storage.removeItem(persistedResultKey(address, endDate));
}

function readPersistedScanHistory(): ScanHistoryRecord[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(SCAN_HISTORY_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScanHistoryRecord).slice(0, MAX_SCAN_HISTORY_RECORDS);
  } catch {
    storage.removeItem(SCAN_HISTORY_KEY);
    return [];
  }
}

function writePersistedScanHistory(records: ScanHistoryRecord[]) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(SCAN_HISTORY_KEY, JSON.stringify(records.slice(0, MAX_SCAN_HISTORY_RECORDS)));
  } catch {
    // Scan history is an audit convenience. Ignore quota failures.
  }
}

function isPersistedResultRecord(value: unknown): value is PersistedResultRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as PersistedResultRecord;
  return isCalculationResult(record.result);
}

function isCalculationResult(value: unknown): value is CalculationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as CalculationResult;
  return Array.isArray(result.dailyRows) && Array.isArray(result.swaps) && Array.isArray(result.txHashes);
}

function isWalletFilter(value: unknown): value is WalletFilter {
  return value === "all" || value === "archived" || value === "running" || value === "pending" || value === "error";
}

function isAppView(value: unknown): value is AppView {
  return value === "overview" || value === "wallets" || value === "scan-records" || value === "reports" || value === "settings";
}

function isScanHistoryRecord(value: unknown): value is ScanHistoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as ScanHistoryRecord;
  return (
    typeof record.id === "string" &&
    typeof record.address === "string" &&
    typeof record.snapshotDate === "string" &&
    isScanMode(record.mode) &&
    (record.status === "success" || record.status === "error") &&
    typeof record.startedAt === "string" &&
    typeof record.endedAt === "string" &&
    typeof record.durationMs === "number"
  );
}

function isScanMode(value: unknown): value is ScanMode {
  return value === "scan" || value === "refresh" || value === "rescan" || value === "archive";
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex], currentIndex);
      }
    }),
  );
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
