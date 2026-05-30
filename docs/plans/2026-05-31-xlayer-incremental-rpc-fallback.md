# S46 X Layer 增量链上兜底与旧归档误报修复

## 背景

生产环境中 12、13 钱包点击“刷新新增”后显示新增 0 笔，但链上直扫确认两个钱包在旧检查点之后都有新的 X Layer OKX Router 交易。根因是 X Layer 索引失败后旧逻辑沿用原归档并写入成功记录，导致“未扫到最新”被误展示为“新增 0”。

## 实现

1. X Layer 仍不允许全窗口 RPC Transfer 日志兜底，避免 10 天慢扫拖垮公共 RPC。
2. 已有归档的增量刷新允许小范围 RPC 兜底，默认上限 120,000 个区块。
3. X Layer 浏览器端直接使用公开 RPC，避免每个 `eth_getLogs` 都经过 Vercel 函数代理；公开 RPC 请求不附带登录 Authorization 头，并在 CSP 中仅放行 `https://rpc.xlayer.tech`。
4. X Layer RPC 兜底使用 100 区块分片、保守 JSON-RPC batch 和较长请求间隔，适配公开 RPC 的 `eth_getLogs` 与限流。
5. BSC RPC 兜底按已知 Boost 代币地址过滤 Transfer 日志，兼容拒绝无 `address` 全网日志查询的标准 RPC 节点。
6. X Layer RPC 兜底按 USDt0 / xBETH 地址过滤 Transfer 日志，减少公共 RPC 的无关日志负载。
7. 浏览器端 X Layer 标准 RPC 走 `/api/rpc?chain=xlayer` 后端代理，避免公共 RPC 响应缺少 CORS 头；服务端 Cron 使用直连 RPC，避免内部任务再绕 Vercel 代理。
8. RPC 兜底发现候选 Transfer 后继续按交易 `from` 和 OKX Router `to` 过滤，保持和原 Boost 解析口径一致。
9. 索引和 RPC 都失败时，如果旧归档没有覆盖最新区块，整次扫描失败并保留旧归档，不再写入“新增 0”的伪成功结果。
10. 只有旧归档已经覆盖当前最新区块时，才允许沿用旧归档作为无需链上读取的结果。

## 验收

1. 直接链上扫描确认 12 钱包旧检查点后有 28 笔 X Layer OKX Router 交易；核心刷新后新增 28 笔，10 日 Boost 从约 1.80 更新到约 5151.53。
2. 直接链上扫描确认 13 钱包旧检查点后有 30 笔可解析 X Layer OKX Router 交易；核心刷新后新增 30 笔，10 日 Boost 从约 1.76 更新到约 5178.45。
3. `npm run build` 通过。
4. 生产环境网页刷新 12 钱包已写入 Supabase：新增 28 笔，X Layer 扫描高度更新到 61395886。
5. 生产环境网页刷新 13 钱包第一次暴露浏览器直连 X Layer 公共 RPC CORS 问题，已改为浏览器走后端代理。
6. 最终生产 Supabase 验证：12 钱包 `xlayer.incrementalNewTxCount=28`，13 钱包 `xlayer.incrementalNewTxCount=30`。
