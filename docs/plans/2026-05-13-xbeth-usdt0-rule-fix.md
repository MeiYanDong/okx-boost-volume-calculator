# S37 xBETH / USDt0 基础倍数特例

## 目标

修复 X Layer 上 `xBETH / USDt0` 被误按普通 X Layer 代币与稳定币组合计算为 `0.5x` 的问题。

## 根因

旧实现只按 token group 判断新规则倍数。`USDt0` 属于 `group1`，未知 X Layer 代币默认属于 `other`，因此 `xBETH / USDt0` 被误套用了 `group1 + other = 0.5x`。

## 实现

1. 在当前规则版本中增加 `xBETH / USDt0` 交易对基础倍数特例：`0.1x`。
2. 提升规则缓存版本，避免本地 parsed swap 缓存继续复用旧 `0.5x` 结果。
3. 抽出归档重定价函数，前端展示和 Cron 定时提醒都会按当前规则重新计算历史归档中的 swap。
4. 继续按交易时间选择规则版本，2026-05-12 前交易仍走旧规则。

## 验收

1. `xBETH / USDt0` 当前规则返回 `0.1x`。
2. `QIC / USDt0` 当前规则仍返回 `0.5x`。
3. 钱包 `0xece47efc0635b5335692dfcdf498dbce4536f158` 的 xBETH 交易解析为 `0.1x`。
4. `npm run build` 通过。
