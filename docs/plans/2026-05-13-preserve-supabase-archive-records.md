# S36 Supabase 归档恢复后被清空修复

## 目标

登录 Supabase 账号后，云端归档恢复出来的 Boost 结果不能被前端钱包列表同步逻辑重置为空。

## 根因

`hydrateServerArchive()` 会把 Supabase 返回的记录标记为 `source: "archive"`。随后 `syncWalletRecords()` 根据钱包列表重新整理 records，但旧逻辑只保留 `source: "fresh"` 且 `windowEnd` 等于当前快照日的结果，导致刚恢复的 Supabase archive 结果被改成 idle。

## 实现

1. `syncWalletRecords()` 保留已有的 `source: "archive"` 结果。
2. 如果 archive 结果的 `windowEnd` 不是当前快照日，保留结果并显示待刷新语义。
3. 仍然只保留当前快照日的 fresh 临时结果，避免切换日期复用未归档 fresh 数据。

## 验收

1. 登录 `myandong1@gmail.com` 后自动恢复 8 个钱包。
2. Supabase archive 记录恢复后不会被钱包列表同步清空。
3. 构建验证通过。
