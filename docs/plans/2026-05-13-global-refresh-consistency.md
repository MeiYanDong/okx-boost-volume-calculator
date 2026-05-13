# S40 全局刷新与单钱包刷新一致性

## 目标

修复全局「刷新新增交易」扫不到最新 X Layer 交易，而单钱包「刷新新增」可以扫到的问题。

## 根因

全局刷新原来会并发刷新多个钱包，并且单个钱包内部也会并发扫描 BNB Chain 与 X Layer。这样会在短时间内连续请求 Ankr Advanced 钱包索引，触发 `API rate limit exceeded`。

旧逻辑还有一个更严重的问题：多链扫描中只要某条链成功，就会把另一条链失败作为 warning，仍然保存结果。因此当 X Layer 被限流、BNB Chain 成功时，程序会把 BSC-only 半成品用新的 `savedAt` 写入 Supabase，覆盖原本更完整的 BSC + X Layer 数据。

## 实现

1. 全局批量刷新改为钱包串行，避免多个钱包同时请求 Ankr。
2. 单个钱包内部改为链串行，避免 BNB Chain 与 X Layer 同时请求 Ankr。
3. Ankr 钱包索引请求遇到限流时自动退避重试。
4. 多链扫描只要任一链失败，就整体失败并保留原归档，不写入半成品。
5. Supabase 写入前增加结果退化判断：如果新结果缺少已有链、区块覆盖倒退、hash/交易明细倒退，则拒绝覆盖。
6. 前端扫描入口改为读取最新 `recordsRef`，避免批量闭包使用旧 records。

## 验收

1. `npm run build` 通过。
2. 对 `myandong1@gmail.com` 的 8 个钱包执行真实全局刷新，最终 8 个成功、0 个失败。
3. 8 个钱包的 2026-05-13 快照均包含 `bsc + xlayer` 两条链。
4. 全局刷新不再把 X Layer 失败时的 BSC-only 结果写入 Supabase。
