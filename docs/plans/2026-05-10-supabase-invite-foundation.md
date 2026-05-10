# S18 子 Plan：Supabase 邀请制基础设施

## 阶段目标

把项目从单一服务端 JSON 归档，推进到可承载邀请制多用户的 Supabase 数据层。

## 实现边界

1. 使用用户指定的 Supabase 账户 2 和组织 `Supabase-1`。
2. 本阶段只建立项目、连接方式、基础表结构、RLS 和 Data API 权限。
3. 仍保留现有 Upstash 归档与前端逻辑，避免一次性切换造成生产不可用。
4. Supabase secret key 只保存到本机 Keychain 和后续 Vercel 环境变量，不提交到仓库。

## 已确认配置

1. Supabase organization：`relojacufntuqfrppfkd`
2. Project：`okx-boost`
3. Project ref：`idhywcizstajdbccwift`
4. Region：`ap-northeast-1`，Northeast Asia Tokyo
5. REST URL：`https://idhywcizstajdbccwift.supabase.co`
6. Pooler：`aws-1-ap-northeast-1.pooler.supabase.com`

## 数据层方案

1. `app_profiles`：用户角色、状态、额度。
2. `invites`：邀请码 hash、过期时间、使用人、额度模板。
3. `workspaces`：用户工作区和目标配置。
4. `wallets`：钱包地址与名称。
5. `wallet_scan_results`：按钱包和快照日期保存扫描结果。
6. `bonus_rules`：按钱包、代币、日期范围管理额外加成。
7. `scan_jobs`：扫描任务审计。
8. `usage_daily`：每日刷新与重扫额度。
9. `notification_settings`：用户级飞书通知配置。

## 当前状态

已完成 Supabase 项目创建、数据库连接验证、基础 migration 推送、RLS 开启、Data API 权限验证，以及 checksum 大小写混合地址兼容。

## 下一步

1. 接入 Supabase JS 客户端。
2. 实现邀请兑换 API。
3. 实现登录后的用户工作区读写。
4. 迁移当前 `default` 归档到管理员账号。
5. 将 Vercel Cron 从 Upstash 归档切到 Supabase 用户工作区。
