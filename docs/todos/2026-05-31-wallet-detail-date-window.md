# S47 钱包详情每日数据窗口口径修复 Todo

- [x] 定位详情页直接使用 `record.result.windowStart/windowEnd` 的问题。
- [x] 恢复当前 UTC 日作为默认可选快照日。
- [x] 防止 Supabase 归档 `endDate` 覆盖页面当前快照日。
- [x] 详情抽屉接收当前 `endDate`。
- [x] 按当前快照窗口重建每日数据展示行。
- [x] 交易明细与代币加成按当前窗口过滤。
- [x] 跑类型检查。
