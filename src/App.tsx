import { AlertCircle, CalendarDays, CheckCircle2, Database, Gauge, Info, Rocket, RotateCcw, Search, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { bonusMultiplierFor } from "./lib/boostRules";
import { BSC_CHAIN, normalizeAddress } from "./lib/chains";
import { calculateBoostVolume, latestSelectableUtcDate, parseBoostOverrides } from "./lib/calculator";
import { clearOkxBoostCache } from "./lib/cache";
import { formatNumber, formatUsd, shortHash } from "./lib/format";
import type { CalculationResult, TokenGroup, TokenMeta } from "./lib/types";

const SAMPLE_WALLET = "0x35217ad88c31db4c95e67b77e68795ea4d54cc30";
const SERVER_MANAGED_EXPLORER_API_KEY = "__server__";
const SERVER_MANAGED_ANKR_RPC_URL = "/api/ankr";
const UI_STATE_KEY = "okx-boost:ui:v1";
const RESULT_CACHE_PREFIX = "okx-boost:result:v2";

type RunState = "idle" | "running" | "done" | "error";
type PersistedUiState = {
  address?: string;
  endDate?: string;
  boostOverrides?: string;
};

export default function App() {
  const maxSnapshotDate = latestSelectableUtcDate();
  const [initialUiState] = useState(readPersistedUiState);
  const [address, setAddress] = useState(initialUiState.address || SAMPLE_WALLET);
  const [endDate, setEndDate] = useState(initialUiState.endDate || maxSnapshotDate);
  const [boostOverrides, setBoostOverrides] = useState(initialUiState.boostOverrides || "");
  const [progress, setProgress] = useState("准备读取钱包交易记录");
  const [state, setState] = useState<RunState>("idle");
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    writePersistedUiState({ address, endDate, boostOverrides });
  }, [address, endDate, boostOverrides]);

  useEffect(() => {
    const saved = readPersistedResult(address, endDate);
    if (saved) {
      setResult(saved);
      setState("done");
      setProgress("已从本地恢复上次计算结果");
    } else {
      setResult(null);
      setState("idle");
      setProgress("准备读取钱包交易记录");
    }
  }, [address, endDate]);

  async function runCalculation() {
    setState("running");
    setError("");
    setResult(null);
    setProgress("启动 BNB Chain 扫描...");

    try {
      const computed = await calculateBoostVolume({
        address,
        endDate,
        chain: BSC_CHAIN,
        apiKey: SERVER_MANAGED_EXPLORER_API_KEY,
        ankrMultichainRpcUrl: SERVER_MANAGED_ANKR_RPC_URL,
        boostBonuses: {},
        onProgress: setProgress,
      });
      setResult(computed);
      writePersistedResult(address, endDate, computed);
      setState("done");
      setProgress("计算完成，结果已保存在本地");
    } catch (caught) {
      setState("error");
      setError(caught instanceof Error ? caught.message : String(caught));
      setProgress("计算失败");
    }
  }

  function clearCache() {
    const removed = clearOkxBoostCache();
    const removedResults = clearPersistedResults();
    const total = removed + removedResults;
    setProgress(total > 0 ? `已清理 ${total} 条本地缓存` : "没有可清理的本地缓存");
  }

  function updateBonusOverrides(value: string) {
    setBoostOverrides(value);
    if (result) setProgress("已本地应用代币额外加成");
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="masthead">
          <div>
            <p className="eyebrow">UTC0 Boost Window</p>
            <h1>OKX Boost 交易量计算器</h1>
          </div>
          <div className="chain-pill">
            <Rocket size={18} />
            <span>{BSC_CHAIN.name}</span>
          </div>
        </div>

        <div className="control-grid compact">
          <label className="field wide">
            <span>
              <Wallet size={16} /> 钱包地址
            </span>
            <input value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false} />
          </label>

          <label className="field">
            <span>
              <CalendarDays size={16} /> 快照日期
            </span>
            <input
              type="date"
              max={maxSnapshotDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
            <small>包含当天；今天可选，未结束时按当前链上区块预估</small>
          </label>
        </div>

        <div className="scope-strip">
          <Info size={18} />
          <span>当前工具只统计 BNB Chain 的 OKX DEX Router 交易；Base / Arbitrum 等跨链交易暂不纳入。</span>
        </div>

        <div className="action-row">
          <button className="primary-action" onClick={runCalculation} disabled={state === "running"}>
            <Search size={18} />
            {state === "running" ? "扫描中" : result ? "重新扫描链上" : "扫描 BNB OKX 聚合交易"}
          </button>
          <button className="secondary-action" onClick={clearCache} disabled={state === "running"} title="清理本地缓存">
            <RotateCcw size={18} />
          </button>
          <div className={`status ${state}`}>
            {state === "done" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{progress}</span>
          </div>
        </div>

        {error && <div className="error-strip">{error}</div>}

        {result && (
          <ResultPanel
            result={result}
            bonusRules={boostOverrides}
            onBonusRulesChange={updateBonusOverrides}
          />
        )}
      </section>
    </main>
  );
}

function formatBonusPercent(multiplier: number): string {
  const percent = (multiplier - 1) * 100;
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${formatNumber(percent, 0)}%`;
}

function ResultPanel({
  result,
  bonusRules,
  onBonusRulesChange,
}: {
  result: CalculationResult;
  bonusRules: string;
  onBonusRulesChange: (value: string) => void;
}) {
  const appliedResult = applyBonusRules(result, bonusRules);
  const bonusRows = buildTokenBonusRows(appliedResult, bonusRules);

  return (
    <section className="results">
      <div className="result-toolbar">
        <div>
          <Database size={17} />
          <span>结果已本地保存，刷新后自动恢复</span>
        </div>
        <div>
          <Gauge size={17} />
          <span>代币加成会即时本地试算，不重新扫链</span>
        </div>
        <div>
          <Rocket size={17} />
          <span>当前范围：BNB Chain</span>
        </div>
      </div>

      <div className="summary-grid">
        <article className="metric-card hero-metric">
          <span>Boost 交易量</span>
          <strong>{formatUsd(appliedResult.averageBoostVolume)}</strong>
          <small>
            {appliedResult.windowStart} 至 {appliedResult.windowEnd} 的 10 日平均值
          </small>
        </article>
        <article className="metric-card">
          <span>10 日合计</span>
          <strong>{formatUsd(appliedResult.totalBoostVolume)}</strong>
          <small>每日 Boost 交易量求和</small>
        </article>
        <article className="metric-card">
          <span>合格成交额</span>
          <strong>{formatUsd(appliedResult.totalTradeUsd)}</strong>
          <small>稳定币侧估值</small>
        </article>
        <article className="metric-card">
          <span>交易笔数</span>
          <strong>{appliedResult.swaps.filter((swap) => swap.status === "counted").length}</strong>
          <small>{appliedResult.txHashes.length} 个候选 hash</small>
        </article>
      </div>

      {appliedResult.warnings.length > 0 && (
        <div className="warning-box">
          {appliedResult.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      {bonusRows.length > 0 && (
        <section className="bonus-panel">
          <div className="panel-title">
            <h2>代币额外加成</h2>
            <span>不筛选交易 · 已识别 {bonusRows.length} 个 token</span>
          </div>
          <div className="bonus-grid">
            {bonusRows.map((row) => (
              <div className="bonus-row" key={row.address}>
                <div className="bonus-token">
                  <strong>{row.symbol}</strong>
                  <small>
                    {row.groupLabel} · {shortAddress(row.address)} · {row.txCount} 笔
                  </small>
                </div>
                <div className="bonus-controls">
                  <label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.percentInput}
                      onChange={(event) =>
                        onBonusRulesChange(updateBonusRuleText(bonusRules, row.address, event.target.value))
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
                        onClick={() => onBonusRulesChange(updateBonusRuleText(bonusRules, row.address, String(percent)))}
                      >
                        {percent === 0 ? "无" : `+${percent}%`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="bonus-actions">
            <p>这里仅调整 token 活动加成；输入后会立即本地重算，不会重新扫描链上，也不会改变交易范围。</p>
          </div>
        </section>
      )}

      <div className="data-grid">
        <section className="table-panel">
          <div className="panel-title">
            <h2>每日数据</h2>
            <span>UTC0</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>当日交易量</th>
                <th>成交额</th>
                <th>笔数</th>
              </tr>
            </thead>
            <tbody>
              {appliedResult.dailyRows.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{formatUsd(row.boostVolume)}</td>
                  <td>{formatUsd(row.tradeUsd)}</td>
                  <td>{row.txCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="table-panel">
          <div className="panel-title">
            <h2>交易明细</h2>
            <span>{appliedResult.swaps.length} rows</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Hash</th>
                <th>日期</th>
                <th>交易对</th>
                <th>成交额</th>
                <th>基础 / 加成</th>
                <th>Boost</th>
              </tr>
            </thead>
            <tbody>
              {appliedResult.swaps.map((swap) => (
                <tr key={swap.hash}>
                  <td>
                    <a href={`${BSC_CHAIN.explorerTxUrl}${swap.hash}`} target="_blank" rel="noreferrer">
                      {shortHash(swap.hash)}
                    </a>
                  </td>
                  <td>{swap.utcDate}</td>
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
              {appliedResult.swaps.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    没有解析到窗口内的 OKX Boost 交易
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}

type TokenBonusRow = {
  address: string;
  symbol: string;
  groupLabel: string;
  txCount: number;
  percentInput: string;
};

function buildTokenBonusRows(result: CalculationResult, bonusRules: string): TokenBonusRow[] {
  const bonuses = parseBoostOverrides(bonusRules);
  const rows = new Map<string, { token: TokenMeta; txHashes: Set<string> }>();

  for (const swap of result.swaps) {
    for (const token of [swap.inputToken, swap.outputToken]) {
      const address = normalizeAddress(token.address);
      if (!rows.has(address)) rows.set(address, { token, txHashes: new Set() });
      rows.get(address)?.txHashes.add(swap.hash);
    }
  }

  return [...rows.entries()]
    .map(([address, row]) => ({
      address,
      symbol: row.token.symbol,
      groupLabel: tokenGroupLabel(row.token.group),
      txCount: row.txHashes.size,
      percentInput: multiplierToPercentInput(bonuses[address] || 1),
      group: row.token.group,
    }))
    .sort((a, b) => {
      const groupOrder: Record<TokenGroup, number> = { other: 0, group2: 1, group1: 2 };
      if (groupOrder[a.group] !== groupOrder[b.group]) return groupOrder[a.group] - groupOrder[b.group];
      if (b.txCount !== a.txCount) return b.txCount - a.txCount;
      return a.symbol.localeCompare(b.symbol);
    });
}

function applyBonusRules(result: CalculationResult, bonusRules: string): CalculationResult {
  const bonuses = parseBoostOverrides(bonusRules);
  const swaps = result.swaps.map((swap) => {
    const bonusMultiplier = bonusMultiplierFor(swap.inputToken, swap.outputToken, bonuses);
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

function updateBonusRuleText(raw: string, address: string, percentRaw: string): string {
  const normalizedAddress = normalizeAddress(address);
  const percent = Number(percentRaw);
  const lines = raw
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => normalizeAddress(line.split(/=|:/)[0] || "") !== normalizedAddress);

  if (Number.isFinite(percent) && percent > 0) {
    lines.push(`${normalizedAddress}=${formatPercentRule(percent)}%`);
  }

  return lines.join("\n");
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

function readPersistedUiState(): PersistedUiState {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    return JSON.parse(storage.getItem(UI_STATE_KEY) || "{}") as PersistedUiState;
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

function readPersistedResult(address: string, endDate: string): CalculationResult | null {
  const storage = safeStorage();
  if (!storage || !address || !endDate) return null;
  try {
    const raw = storage.getItem(persistedResultKey(address, endDate));
    return raw ? (JSON.parse(raw) as CalculationResult) : null;
  } catch {
    storage.removeItem(persistedResultKey(address, endDate));
    return null;
  }
}

function writePersistedResult(address: string, endDate: string, result: CalculationResult) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(persistedResultKey(address, endDate), JSON.stringify(result));
  } catch {
    // Persisted results are a convenience layer. Ignore quota failures.
  }
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

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
