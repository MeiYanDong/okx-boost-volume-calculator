# S48 归档窗口错位数据隐藏修复

## 目标

Supabase 已保存的钱包扫描结果必须直接恢复展示。即使归档结果的 `windowEnd` 不是当前页面快照日，也不能把 `result` 清空成待刷新；页面应基于已有 `dailyRows` / `swaps` 按当前快照日重新统计。

## 根因

S47 为了避免详情页展示旧日期范围，在 `syncWalletRecords` 和 `hydrateRecordsFromServerArchive` 中加入了 `windowEnd !== endDate` 时清空结果的逻辑。这会导致 Supabase 返回最近旧归档时，页面把已有数据误判为没有归档，用户看到所有钱包都需要重扫。

## 实现

1. `hydrateRecordsFromServerArchive` 对任何有效 `archived.result` 都恢复为 `done`。
2. `syncWalletRecords` 保留已有 archive result，不再因 `windowEnd` 不同清空结果。
3. 日期窗口差异只留给展示层处理：总览、钱包列表、报表和详情页按当前 `endDate` 重新聚合。

## 验收

1. 登录后 Supabase 返回旧快照归档时，钱包仍显示为已归档。
2. 旧归档不会让页面提示全部待重扫。
3. 当前快照日仍用于 10 日窗口统计和详情页每日数据展示。
4. `npm run build` 通过。
