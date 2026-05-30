# S44 X Layer 索引失败归档复用

## 背景

用户看到错误：

`部分链扫描失败，已保留原归档，未写入半成品结果：X Layer: RPC 公开链上记录读取失败：X Layer requires Ankr Advanced wallet index; RPC log fallback is disabled for this chain.`

实际根因不是 RPC 日志兜底本身，而是 X Layer 钱包交易发现没有拿到可用索引。X Layer 设计上不允许使用公共 RPC 扫 10 天 Transfer 日志兜底，因为该路径极慢且不稳定。当前 Ankr Advanced 对 `xlayer` 返回 `No nodes available` 时，旧逻辑继续落到禁用的 RPC fallback，导致错误文案误导，并让 BNB Chain 的增量刷新也被整笔阻断。

## 实现

1. X Layer 仍保持 `rpcLogFallbackEnabled: false`，不启用公开 RPC 日志兜底。
2. 钱包索引失败时收集真实索引错误，例如 `Ankr Advanced: No nodes available`。
3. 对禁用 RPC fallback 的链，直接抛出“需要可用的钱包交易索引”的错误，不再包装成“RPC 公开链上记录读取失败”。
4. 增量刷新时，如果失败链已有可兼容的原归档，沿用该链归档并记录 warning。可兼容是指旧窗口与当前窗口有重叠，且该链有 `chainScans` 或交易证据。
5. 沿用旧链归档时，按当前快照窗口重新过滤交易并重算每日数据；扫描高度仍保留旧链原高度，不冒充扫到最新。
6. 其他链可以继续刷新，最终结果仍包含失败链的原归档，不会保存缺链半成品。
7. 强制重扫不复用旧归档，仍要求完整重新发现交易。

## 验收

1. X Layer Ankr 索引不可用时，错误信息展示真实索引原因。
2. 可兼容窗口已有 X Layer 归档时，增量刷新不再因为 X Layer 临时索引失败阻断 BNB Chain 更新。
3. 结果仍包含 X Layer 原归档的 `chainScans` 和交易明细，不退化为 BSC-only 半成品。
4. 强制重扫仍完整失败，避免把旧数据伪装成重扫结果。
5. `npm run build` 通过。
