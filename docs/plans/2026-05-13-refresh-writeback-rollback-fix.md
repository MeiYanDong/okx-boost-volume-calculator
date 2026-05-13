# S39 刷新增量并发写回防回退

## 目标

修复点击「刷新新增交易」后，最新数据被旧快照覆盖、页面回到更早数据的问题。

## 根因

批量刷新时每个钱包成功后都会立即写入 Supabase。旧实现即时写入的是闭包中的旧全量 `records`，不是只写当前钱包。多个钱包并发刷新时，最后完成的钱包会把其它钱包的旧结果一起写回同一个快照日，覆盖之前已经更新过的数据。

第一次修复后仍有两个漏洞：

1. 自动同步 effect 会在批量刷新结束后提交整份 `records`，这份列表仍可能混入旧结果。
2. 后端先查询 `saved_at` 再 upsert 不是原子操作，并发请求仍可能先通过检查、后覆盖新记录。

再次复核发现第三个漏洞：登录 Supabase 后，钱包列表同步函数仍然会读取浏览器 localStorage 里的旧结果缓存。页面刷新时，云端归档先恢复最新数据，随后钱包同步 effect 可能用旧本地缓存覆盖界面状态，造成“Supabase 有最新记录，但页面显示不是最新”的现象。

## 实现

1. 前端即时保存只提交当前成功刷新的钱包记录。
2. 自动同步 effect 只提交钱包列表、目标、加成、扫描历史等设置，不再提交扫描结果。
3. 后端写入扫描结果时先执行带 `saved_at <= incoming.saved_at` 条件的数据库 update。
4. 如果没有现有记录则 insert；如果 insert 冲突，再重试条件 update。
5. 旧 `savedAt` 请求无法覆盖新结果，即使并发到达也会被数据库条件挡住。
6. 钱包列表同步增加 `allowLocalCache` 开关；登录 Supabase 时完全不读取本地结果缓存。

## 验收

1. 即时保存 payload 不再携带旧全量 `records`。
2. 自动同步 payload 不再携带扫描结果。
3. 后端会跳过旧 `savedAt` 的扫描结果。
4. 用临时 Supabase workspace 验证旧 `savedAt` 更新 0 行、新 `savedAt` 更新 1 行。
5. 登录态下 `syncWalletRecords` 不再调用 `readPersistedResult`。
6. 对 `myandong1@gmail.com` 的 8 个钱包执行真实增量刷新，2026-05-13 快照全部写入 Supabase，最新 `saved_at` 为 2026-05-13 14:01 UTC。
7. `npm run build` 通过。
8. 本地页面刷新后正常加载。
