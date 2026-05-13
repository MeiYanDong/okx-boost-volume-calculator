# S39 刷新增量并发写回防回退 Todo

- [x] 定位批量刷新即时写入使用旧 `records` 闭包的问题
- [x] 将即时保存改为只提交当前钱包记录
- [x] 移除旧的全量快照构造函数
- [x] 定位自动同步 effect 仍会提交旧全量 `records` 的问题
- [x] 将自动同步改为只保存设置与扫描历史，不写扫描结果
- [x] 定位后端先查 `saved_at` 再 upsert 的非原子并发漏洞
- [x] 后端改为数据库条件 update + insert 冲突重试
- [x] 旧 `savedAt` 结果不再覆盖数据库新结果
- [x] 使用临时 Supabase workspace 验证旧写入 0 行、新写入 1 行
- [x] 定位登录 Supabase 后仍读取浏览器本地结果缓存的问题
- [x] 登录态钱包同步禁用 localStorage 结果缓存
- [x] 真实增量刷新 `myandong1@gmail.com` 的 8 个钱包并确认写入 Supabase
- [x] 构建验证通过
- [x] 重启本地服务并验证页面加载
