import {
  AlertCircle,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  Gauge,
  Home,
  Inbox,
  Info,
  ListChecks,
  LockKeyhole,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  UserCircle,
  Users,
  Wallet,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BSC_CHAIN, isAddress, normalizeAddress } from "./lib/chains";
import { calculateBoostVolume, latestSelectableUtcDate } from "./lib/calculator";
import { clearOkxBoostCache } from "./lib/cache";
import { formatNumber, formatUsd, shortHash } from "./lib/format";
import { readServerAccessPassword, writeServerAccessPassword } from "./lib/serverAccess";
import type { CalculationResult, ParsedSwap, TokenGroup, TokenMeta } from "./lib/types";

const SAMPLE_WALLET = "0x35217ad88c31db4c95e67b77e68795ea4d54cc30";
const SERVER_MANAGED_EXPLORER_API_KEY = "__server__";
const SERVER_MANAGED_ANKR_RPC_URL = "/api/ankr";
const UI_STATE_KEY = "okx-boost:ui:v4";
const RESULT_CACHE_PREFIX = "okx-boost:result:v2";
const BULK_SCAN_CONCURRENCY = 3;

type RunState = "idle" | "running" | "done" | "error";
type ArchiveSource = "empty" | "archive" | "fresh";
type WalletFilter = "all" | "archived" | "running" | "pending" | "error";
type DetailTab = "daily" | "bonus" | "tx";
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
  dailyTarget?: string;
  walletFilter?: WalletFilter;
};
type PersistedResultRecord = {
  result: CalculationResult;
  savedAt?: string;
};
type WalletArchiveRecord = {
  address: string;
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
  label?: string;
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

export default function App() {
  const maxSnapshotDate = latestSelectableUtcDate();
  const [initialUiState] = useState(readPersistedUiState);
  const initialWalletsText = initialUiState.walletsText || initialUiState.address || SAMPLE_WALLET;
  const initialEndDate = initialUiState.endDate || maxSnapshotDate;
  const [walletsText, setWalletsText] = useState(initialWalletsText);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [dailyTarget, setDailyTarget] = useState(initialUiState.dailyTarget || "");
  const [accessPassword, setAccessPassword] = useState(readServerAccessPassword);
  const [boostOverrides, setBoostOverrides] = useState(initialUiState.boostOverrides || "");
  const [selectedWallet, setSelectedWallet] = useState(initialUiState.selectedWallet || "");
  const [walletFilter, setWalletFilter] = useState<WalletFilter>(initialUiState.walletFilter || "all");
  const [walletEditorOpen, setWalletEditorOpen] = useState(false);
  const [progress, setProgress] = useState("准备同步钱包归档");
  const [error, setError] = useState("");
  const [records, setRecords] = useState<WalletArchiveRecord[]>(() =>
    syncWalletRecords([], parseWalletList(initialWalletsText).addresses, initialEndDate),
  );

  const parsedWallets = useMemo(() => parseWalletList(walletsText), [walletsText]);
  const walletsKey = parsedWallets.addresses.join(",");
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
  const targetDaily = parseOptionalAmount(dailyTarget);
  const portfolio = useMemo(
    () => buildPortfolioSummary(appliedRecords, endDate, targetDaily),
    [appliedRecords, endDate, targetDaily],
  );
  const selectedRecord = appliedRecords.find((record) => record.address === selectedWallet) || null;
  const detailEntryRecord = appliedRecords.find((record) => record.result) || null;

  useEffect(() => {
    writePersistedUiState({
      walletsText,
      endDate,
      boostOverrides,
      selectedWallet,
      dailyTarget,
      walletFilter,
    });
  }, [walletsText, endDate, boostOverrides, selectedWallet, dailyTarget, walletFilter]);

  useEffect(() => {
    writeServerAccessPassword(accessPassword);
  }, [accessPassword]);

  useEffect(() => {
    setRecords((current) => syncWalletRecords(current, parsedWallets.addresses, endDate));
  }, [walletsKey, endDate, parsedWallets.addresses]);

  useEffect(() => {
    if (selectedWallet && !parsedWallets.addresses.includes(selectedWallet)) {
      setSelectedWallet("");
    }
  }, [selectedWallet, walletsKey, parsedWallets.addresses]);

  async function scanAll(forceRefresh = false) {
    setError("");
    const addresses = parsedWallets.addresses;
    if (!addresses.length) {
      setError("请先填写至少一个有效的钱包地址。");
      setProgress("等待有效钱包地址");
      setWalletEditorOpen(true);
      return;
    }

    if (forceRefresh) {
      for (const wallet of addresses) clearPersistedResult(wallet, endDate);
    }

    const concurrency = Math.min(BULK_SCAN_CONCURRENCY, addresses.length);
    let completed = 0;
    let failed = 0;
    setProgress(
      forceRefresh
        ? `开始并行强制重扫所有钱包（${concurrency} 路）...`
        : `开始并行增量刷新钱包归档（${concurrency} 路）...`,
    );

    await runWithConcurrency(addresses, concurrency, async (wallet, index) => {
      const ok = await scanWallet(wallet, {
        forceRefresh,
        refresh: !forceRefresh,
        label: `${index + 1}/${addresses.length}`,
      });
      completed += 1;
      if (!ok) failed += 1;
      const action = forceRefresh ? "强制重扫" : "增量刷新";
      setProgress(`${action}进度 ${completed}/${addresses.length}${failed ? `，失败 ${failed}` : ""}`);
    });

    if (failed > 0) {
      setProgress(forceRefresh ? `强制重扫完成，${failed} 个钱包失败` : `增量刷新完成，${failed} 个钱包失败`);
    } else {
      setProgress(forceRefresh ? "强制重扫完成" : "增量刷新完成");
    }
  }

  async function scanWallet(address: string, options: ScanWalletOptions = {}) {
    const normalizedAddress = normalizeAddress(address);
    const cached = options.forceRefresh ? null : readPersistedResult(normalizedAddress, endDate);
    if (cached && !options.refresh) {
      patchRecord(normalizedAddress, {
        state: "done",
        source: "archive",
        result: cached.result,
        savedAt: cached.savedAt,
        progress: "已使用本地归档",
        error: "",
      });
      setProgress(`${shortAddress(normalizedAddress)} 已使用本地归档`);
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
          const prefix = options.label ? `${options.label} ${shortAddress(normalizedAddress)}` : shortAddress(normalizedAddress);
          patchRecord(normalizedAddress, { progress: message });
          setProgress(`${prefix}: ${message}`);
        },
      });
      const savedAt = new Date().toISOString();
      writePersistedResult(normalizedAddress, endDate, computed, savedAt);
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
      patchRecord(normalizedAddress, {
        state: "error",
        error: message,
        progress: "计算失败",
      });
      setError(`${shortAddress(normalizedAddress)} 计算失败：${message}`);
      return false;
    }
  }

  function patchRecord(address: string, patch: Partial<WalletArchiveRecord>) {
    const normalizedAddress = normalizeAddress(address);
    setRecords((current) =>
      current.map((record) => (record.address === normalizedAddress ? { ...record, ...patch } : record)),
    );
  }

  function clearCache() {
    const removedRuntimeCache = clearOkxBoostCache();
    const removedResults = clearPersistedResults();
    const total = removedRuntimeCache + removedResults;
    setRecords((current) =>
      current.map((record) => ({
        ...record,
        state: "idle",
        source: "empty",
        result: null,
        error: "",
        progress: "本地归档已清理",
        savedAt: undefined,
      })),
    );
    setSelectedWallet("");
    setProgress(total > 0 ? `已清理 ${total} 条本地归档和运行缓存` : "没有可清理的本地缓存");
  }

  function updateBonusOverrides(value: string) {
    setBoostOverrides(value);
    setProgress("已本地应用代币额外加成，不重新扫链");
  }

  function openDetailEntry() {
    if (detailEntryRecord) {
      setSelectedWallet(detailEntryRecord.address);
      return;
    }
    setWalletEditorOpen(true);
  }

  return (
    <main className="app-frame">
      <Sidebar
        walletCount={portfolio.totalWallets}
        onOpenWalletEditor={() => setWalletEditorOpen(true)}
        onClearCache={clearCache}
        disabled={anyRunning}
      />

      <section className="main-workspace">
        <Topbar />

        <Toolbar
          endDate={endDate}
          maxSnapshotDate={maxSnapshotDate}
          walletFilter={walletFilter}
          archivedWallets={portfolio.archivedWallets}
          totalWallets={portfolio.totalWallets}
          anyRunning={anyRunning}
          onEndDateChange={setEndDate}
          onWalletFilterChange={setWalletFilter}
          onSync={() => scanAll(false)}
          onForceScan={() => scanAll(true)}
        />

        <StatusStrip
          progress={progress}
          error={error}
          invalidWallets={parsedWallets.invalid}
          duplicateCount={parsedWallets.duplicateCount}
          onOpenWalletEditor={() => setWalletEditorOpen(true)}
        />

        {walletEditorOpen && (
          <WalletEditor
            walletsText={walletsText}
            accessPassword={accessPassword}
            validCount={parsedWallets.addresses.length}
            invalidCount={parsedWallets.invalid.length}
            onWalletsTextChange={setWalletsText}
            onAccessPasswordChange={setAccessPassword}
            onClose={() => setWalletEditorOpen(false)}
          />
        )}

        <div className="dashboard-grid">
          <WalletTablePanel
            records={filteredRecords}
            totalRecords={appliedRecords.length}
            endDate={endDate}
            targetDaily={targetDaily}
            selectedWallet={selectedWallet}
            disabled={anyRunning}
            onSelectWallet={setSelectedWallet}
            onScanWallet={(address) => scanWallet(address)}
            onRefreshWallet={(address) => scanWallet(address, { refresh: true })}
            onForceScanWallet={(address) => scanWallet(address, { forceRefresh: true })}
            onOpenWalletEditor={() => setWalletEditorOpen(true)}
          />

          <OverviewRail
            portfolio={portfolio}
            targetDaily={targetDaily}
            dailyTargetText={dailyTarget}
            onDailyTargetChange={setDailyTarget}
            onSync={() => scanAll(false)}
            onOpenDetail={openDetailEntry}
            detailDisabled={!detailEntryRecord}
          />
        </div>

        {selectedRecord?.result && (
          <WalletDetailDrawer
            record={selectedRecord}
            bonusRules={boostOverrides}
            onBonusRulesChange={updateBonusOverrides}
            onRefresh={() => scanWallet(selectedRecord.address, { refresh: true })}
            onForceScan={() => scanWallet(selectedRecord.address, { forceRefresh: true })}
            disabled={anyRunning}
            onClose={() => setSelectedWallet("")}
          />
        )}
      </section>
    </main>
  );
}

function Sidebar({
  walletCount,
  onOpenWalletEditor,
  onClearCache,
  disabled,
}: {
  walletCount: number;
  onOpenWalletEditor: () => void;
  onClearCache: () => void;
  disabled: boolean;
}) {
  const groups: Array<{
    title?: string;
    items: Array<{ label: string; icon: LucideIcon; active?: boolean; badge?: string; onClick?: () => void; disabled?: boolean }>;
  }> = [
    {
      items: [{ label: "总览", icon: Home, active: true }],
    },
    {
      title: "钱包管理",
      items: [
        { label: "所有钱包", icon: WalletCards, badge: String(walletCount), onClick: onOpenWalletEditor },
        { label: "分组管理", icon: Users },
        { label: "导入钱包", icon: Upload, onClick: onOpenWalletEditor },
      ],
    },
    {
      title: "数据与扫描",
      items: [
        { label: "扫描记录", icon: ClipboardList },
        { label: "扫描任务", icon: ListChecks },
      ],
    },
    {
      title: "分析",
      items: [{ label: "统计报表", icon: BarChart3 }],
    },
    {
      title: "设置",
      items: [
        { label: "提醒设置", icon: Bell },
        { label: "偏好设置", icon: Settings },
        { label: "清理归档", icon: X, onClick: onClearCache, disabled },
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

function Topbar() {
  return (
    <header className="topbar">
      <div>
        <h1>OKX Boost 钱包总览</h1>
        <span>BNB Chain · 最近 10 天 Boost 交易归档</span>
      </div>
      <div className="topbar-actions">
        <button type="button" title="帮助">
          <CircleHelp size={19} />
        </button>
        <button type="button" title="提醒">
          <Bell size={19} />
        </button>
        <div className="user-chip">
          <UserCircle size={25} />
          <strong>MYANDONG</strong>
          <ChevronDown size={15} />
        </div>
      </div>
    </header>
  );
}

function Toolbar({
  endDate,
  maxSnapshotDate,
  walletFilter,
  archivedWallets,
  totalWallets,
  anyRunning,
  onEndDateChange,
  onWalletFilterChange,
  onSync,
  onForceScan,
}: {
  endDate: string;
  maxSnapshotDate: string;
  walletFilter: WalletFilter;
  archivedWallets: number;
  totalWallets: number;
  anyRunning: boolean;
  onEndDateChange: (value: string) => void;
  onWalletFilterChange: (value: WalletFilter) => void;
  onSync: () => void;
  onForceScan: () => void;
}) {
  return (
    <section className="toolbar" aria-label="扫描工具条">
      <div className="snapshot-label">
        <span>快照时间：</span>
        <strong>{endDate} 00:00 UTC</strong>
        <Clock3 size={16} />
      </div>

      <label className="toolbar-control date-control">
        <CalendarDays size={17} />
        <span>最近 10 天（含今天）</span>
        <input
          type="date"
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

      <button type="button" className="toolbar-button" onClick={onForceScan} disabled={anyRunning}>
        <RefreshCcw size={17} />
        强制重新扫描
      </button>

      <button type="button" className="toolbar-icon-button" onClick={onSync} disabled={anyRunning} title="增量刷新归档">
        <RefreshCcw size={17} />
      </button>
    </section>
  );
}

function StatusStrip({
  progress,
  error,
  invalidWallets,
  duplicateCount,
  onOpenWalletEditor,
}: {
  progress: string;
  error: string;
  invalidWallets: string[];
  duplicateCount: number;
  onOpenWalletEditor: () => void;
}) {
  const hasWarning = invalidWallets.length > 0 || duplicateCount > 0;
  return (
    <div className={`system-strip ${error ? "error" : hasWarning ? "warning" : ""}`}>
      {error ? <AlertCircle size={17} /> : hasWarning ? <Info size={17} /> : <ShieldCheck size={17} />}
      <span>
        {error ||
          (hasWarning
            ? `已跳过 ${invalidWallets.length} 个无效地址，合并 ${duplicateCount} 个重复地址`
            : progress)}
      </span>
      <button type="button" onClick={onOpenWalletEditor}>
        钱包列表
      </button>
    </div>
  );
}

function WalletEditor({
  walletsText,
  accessPassword,
  validCount,
  invalidCount,
  onWalletsTextChange,
  onAccessPasswordChange,
  onClose,
}: {
  walletsText: string;
  accessPassword: string;
  validCount: number;
  invalidCount: number;
  onWalletsTextChange: (value: string) => void;
  onAccessPasswordChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="wallet-editor-panel">
      <div className="editor-title">
        <div>
          <h2>钱包列表</h2>
          <span>一行一个地址。有效 {validCount} 个，无效 {invalidCount} 个。</span>
        </div>
        <button type="button" onClick={onClose} title="关闭钱包列表">
          <X size={18} />
        </button>
      </div>
      <div className="editor-grid">
        <label className="editor-field wallet-textarea">
          <span>
            <Wallet size={16} /> 钱包地址
          </span>
          <textarea value={walletsText} onChange={(event) => onWalletsTextChange(event.target.value)} spellCheck={false} />
        </label>
        <label className="editor-field">
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
          <small>只保存在本机浏览器，用于访问你的私有后端 API。</small>
        </label>
      </div>
    </section>
  );
}

function WalletTablePanel({
  records,
  totalRecords,
  endDate,
  targetDaily,
  selectedWallet,
  disabled,
  onSelectWallet,
  onScanWallet,
  onRefreshWallet,
  onForceScanWallet,
  onOpenWalletEditor,
}: {
  records: WalletArchiveRecord[];
  totalRecords: number;
  endDate: string;
  targetDaily: number | null;
  selectedWallet: string;
  disabled: boolean;
  onSelectWallet: (address: string) => void;
  onScanWallet: (address: string) => void;
  onRefreshWallet: (address: string) => void;
  onForceScanWallet: (address: string) => void;
  onOpenWalletEditor: () => void;
}) {
  return (
    <section className="wallet-table-card">
      <div className="table-card-header">
        <div>
          <h2>所有钱包</h2>
          <span>{records.length} / {totalRecords} 条</span>
        </div>
        <button type="button" onClick={onOpenWalletEditor}>
          <Upload size={16} />
          导入钱包
        </button>
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
                targetDaily={targetDaily}
                selected={selectedWallet === record.address}
                disabled={disabled}
                onSelect={() => onSelectWallet(record.address)}
                onScan={() => onScanWallet(record.address)}
                onRefresh={() => onRefreshWallet(record.address)}
                onForceScan={() => onForceScanWallet(record.address)}
              />
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-row">
                  当前筛选下没有钱包。打开钱包列表添加地址或切换筛选条件。
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
  targetDaily,
  selected,
  disabled,
  onSelect,
  onScan,
  onRefresh,
  onForceScan,
}: {
  record: WalletArchiveRecord;
  index: number;
  endDate: string;
  targetDaily: number | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onScan: () => void;
  onRefresh: () => void;
  onForceScan: () => void;
}) {
  const todayRow = record.result?.dailyRows.find((row) => row.date === endDate);
  const targetDelta = record.result && targetDaily !== null ? record.result.averageBoostVolume - targetDaily : null;
  const displayName = walletDisplayName(index);

  return (
    <tr className={selected ? "selected-row" : ""}>
      <td>
        <button className="wallet-identity" type="button" onClick={onSelect}>
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
          {record.result ? (
            <>
              <button type="button" className="row-detail-button" onClick={onSelect}>
                查看详情
                <ChevronRight size={15} />
              </button>
              <button type="button" className="row-refresh-button" onClick={onRefresh} disabled={disabled} title="只扫描新区块">
                <RefreshCcw size={15} />
                刷新
              </button>
            </>
          ) : (
            <button type="button" className="row-detail-button" onClick={onScan} disabled={disabled}>
              扫描
            </button>
          )}
          {record.result && (
            <button type="button" className="row-rescan-button" onClick={onForceScan} disabled={disabled} title="清空该钱包归档后完整重扫">
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

function OverviewRail({
  portfolio,
  targetDaily,
  dailyTargetText,
  onDailyTargetChange,
  onSync,
  onOpenDetail,
  detailDisabled,
}: {
  portfolio: PortfolioSummary;
  targetDaily: number | null;
  dailyTargetText: string;
  onDailyTargetChange: (value: string) => void;
  onSync: () => void;
  onOpenDetail: () => void;
  detailDisabled: boolean;
}) {
  return (
    <aside className="overview-rail">
      <section className="overview-card">
        <div className="overview-card-title">
          <h2>总体概览</h2>
          <button type="button" onClick={onSync}>
            <RefreshCcw size={16} />
            实时更新
          </button>
        </div>

        <div className="overview-counts">
          <MetricLine label="钱包总数" value={String(portfolio.totalWallets)} />
          <MetricLine label="已归档钱包" value={String(portfolio.archivedWallets)} />
          <MetricLine label="扫描中钱包" value={String(portfolio.runningWallets)} />
          <MetricLine label="等待扫描钱包" value={String(portfolio.pendingWallets)} />
        </div>

        <div className="overview-divider" />

        <div className="overview-metrics">
          <MetricLine label="10 日合计 Boost" value={formatUsd(portfolio.totalBoostVolume)} strong />
          <MetricLine label="10 日平均 Boost" value={formatUsd(portfolio.averageBoostVolume)} strong />
          <MetricLine label="今日 Boost" value={formatUsd(portfolio.todayBoostVolume)} strong />
        </div>

        <label className="target-input-control">
          <span>日均目标</span>
          <input
            type="number"
            min="0"
            step="1"
            value={dailyTargetText}
            onChange={(event) => onDailyTargetChange(event.target.value)}
            placeholder="可选"
          />
        </label>

        <div className="target-progress">
          <div>
            <span>目标达成率</span>
            <strong>{targetDaily ? `${formatNumber(portfolio.targetRate, 1)}%` : "--"}</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${targetDaily ? Math.min(portfolio.targetRate, 100) : 0}%` }} />
          </div>
        </div>
      </section>

      <section className="detail-entry-card">
        <div>
          <h2>代币与交易明细</h2>
          <span>查看钱包包含的代币表现与交易明细</span>
        </div>
        <button type="button" onClick={onOpenDetail} disabled={detailDisabled}>
          进入查看
          <ChevronRight size={16} />
        </button>
      </section>
    </aside>
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

function WalletDetailDrawer({
  record,
  bonusRules,
  onBonusRulesChange,
  onRefresh,
  onForceScan,
  disabled,
  onClose,
}: {
  record: WalletArchiveRecord;
  bonusRules: string;
  onBonusRulesChange: (value: string) => void;
  onRefresh: () => void;
  onForceScan: () => void;
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
            <h2>{shortAddress(record.address)} 详情</h2>
            <span>
              {result.windowStart} 至 {result.windowEnd} · {formatSavedAt(record.savedAt)} · {discoverySourceLabel(result.txDiscoverySource)}
            </span>
          </div>
          <div className="drawer-header-actions">
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
                    <article className="token-bonus-card" key={row.address}>
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
  targetDaily: number | null,
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

  const targetTotal = targetDaily === null ? 0 : targetDaily * records.length;
  const targetGap = targetDaily === null ? 0 : targetTotal - averageBoostVolume;
  const targetRate = targetTotal > 0 ? (averageBoostVolume / targetTotal) * 100 : 0;
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

function parseWalletList(raw: string): { addresses: string[]; invalid: string[]; duplicateCount: number } {
  const seen = new Set<string>();
  const invalid: string[] = [];
  let duplicateCount = 0;

  for (const chunk of raw.split(/[\s,，;；]+/)) {
    const candidate = chunk.trim();
    if (!candidate) continue;
    if (!isAddress(candidate)) {
      invalid.push(candidate);
      continue;
    }
    const normalized = normalizeAddress(candidate);
    if (seen.has(normalized)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(normalized);
  }

  return { addresses: [...seen], invalid, duplicateCount };
}

function syncWalletRecords(current: WalletArchiveRecord[], addresses: string[], endDate: string): WalletArchiveRecord[] {
  const currentByAddress = new Map(current.map((record) => [record.address, record]));
  return addresses.map((address) => {
    const existing = currentByAddress.get(address);
    if (existing?.state === "running") return existing;
    const persisted = readPersistedResult(address, endDate);
    if (persisted) {
      return {
        address,
        state: "done",
        source: "archive",
        result: persisted.result,
        progress: "已从本地归档恢复",
        error: "",
        savedAt: persisted.savedAt,
      };
    }
    if (existing && existing.result && existing.source === "fresh") return existing;
    return {
      address,
      state: "idle",
      source: "empty",
      result: null,
      progress: "等待扫描",
      error: "",
    };
  });
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

function walletDisplayName(index: number): string {
  return index === 0 ? "MyanDong" : `Wallet-${String(index + 1).padStart(2, "0")}`;
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

function discoverySourceLabel(source: CalculationResult["txDiscoverySource"]): string {
  if (source === "ankr") return "Ankr 索引";
  if (source === "explorer") return "Explorer 索引";
  if (source === "rpc") return "RPC 兜底";
  if (source === "import") return "导入记录";
  if (source === "archive") return "本地归档";
  return "已归档";
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

function readPersistedUiState(): PersistedUiState {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const state = JSON.parse(storage.getItem(UI_STATE_KEY) || "{}") as PersistedUiState;
    return {
      ...state,
      walletFilter: isWalletFilter(state.walletFilter) ? state.walletFilter : "all",
    };
  } catch {
    storage.removeItem(UI_STATE_KEY);
    return {};
  }
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

function clearPersistedResults(): number {
  const storage = safeStorage();
  if (!storage) return 0;
  let removed = 0;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(RESULT_CACHE_PREFIX)) {
      storage.removeItem(key);
      removed += 1;
    }
  }
  return removed;
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
