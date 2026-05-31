# Plan 纲领

> 维护规则：本文由 Agent 维护。每次完成代码改动后，必须同步更新本文状态，并保持对子 plan 的索引。

## 当前阶段

S47：钱包详情每日数据窗口口径修复已完成。

S47 修复钱包详情页直接展示归档结果自带窗口的问题。详情抽屉现在按当前页面快照日重新生成 10 日每日数据窗口，并同步过滤代币加成项与交易明细；云端归档读取不再把页面快照日改成旧归档日期。

子 plan：[S47 钱包详情每日数据窗口口径修复](./plans/2026-05-31-wallet-detail-date-window.md)

## 阶段索引

| 阶段 | 状态 | 子 plan | 目标 |
| --- | --- | --- | --- |
| S0 文档治理 | 已完成 | 本文与 todo 纲领 | 建立需求、plan、todo 分层规则 |
| S1 Dashboard Layout Rebuild | 已完成 | [子 plan](./plans/2026-05-07-dashboard-layout-rebuild.md) | 复刻参考图布局，保留 OKX Wallet 主题 |
| S2 交互与归档完善 | 已完成 | [子 plan](./plans/2026-05-07-interaction-archive-polish.md) | 完成核心扫描、归档、详情和加成工作流 |
| S3 文档与部署同步 | 进行中 | [子 plan](./plans/2026-05-07-docs-deploy-sync.md) | 完成文档更新和 Vercel 生产部署 |
| S4 小功能页面 | 已完成 | [子 plan](./plans/2026-05-07-secondary-pages-score-model.md) | 开发侧边栏其余辅助页面 |
| S5 总体概览布局抛光 | 已完成 | [子 plan](./plans/2026-05-08-overview-layout-polish.md) | 重排总体概览，避免数值挤压和堆叠 |
| S6 行动驱动交互改良 | 已完成 | [子 plan](./plans/2026-05-08-action-driven-interactions.md) | 收敛主动作、隔离危险动作、补齐 hover/click 反馈 |
| S7 网页端布局清理 | 已完成 | [子 plan](./plans/2026-05-08-web-layout-cleanup.md) | 修复首屏控件拥挤、钱包列表挤压和总进度换行 |
| S8 删除全局状态条 | 已完成 | [子 plan](./plans/2026-05-08-remove-global-status-strip.md) | 删除跨页面重复的同步提示和状态条入口 |
| S9 日期选择与钱包重命名 | 已完成 | [子 plan](./plans/2026-05-08-date-picker-wallet-renaming.md) | 恢复主日期选择能力，支持钱包自定义名称 |
| S10 钱包管理独立页面 | 已完成 | [子 plan](./plans/2026-05-08-wallet-management-page.md) | 将钱包管理收敛到侧边栏独立页面 |
| S11 钱包管理页布局重构 | 已完成 | [子 plan](./plans/2026-05-08-wallet-management-layout.md) | 将钱包管理页改为独立工作台布局 |
| S12 钱包管理页重命名入口 | 已完成 | [子 plan](./plans/2026-05-08-wallet-management-rename-entry.md) | 在钱包管理页补齐显式重命名按钮 |
| S13 快照预警与未来 3 天预测 | 已完成 | [子 plan](./plans/2026-05-09-snapshot-forecast-alerts.md) | 按 UTC 日结快照口径预测未来达标风险 |
| S14 清理归档入口移除与飞书通知 | 已完成 | [子 plan](./plans/2026-05-09-feishu-notification-cleanup.md) | 移除不必要破坏性入口，支持快照风险飞书提醒 |
| S15 到期交易量文案收敛 | 已完成 | [子 plan](./plans/2026-05-09-expiring-volume-copy.md) | 只展示到期交易量，不展示刷量日期 |
| S16 服务端归档与每日自动刷新 | 已完成 | [子 plan](./plans/2026-05-09-server-cron-refresh.md) | 用 Upstash 保存归档，Vercel Cron 每天增量刷新并自动飞书提醒 |
| S17 归档数据空间隔离 | 已完成 | [子 plan](./plans/2026-05-10-archive-workspaces.md) | 用数据空间隔离用户归档，避免新增地址被旧归档覆盖 |
| S18 Supabase 邀请制基础设施 | 已完成 | [子 plan](./plans/2026-05-10-supabase-invite-foundation.md) | 建立邀请制多用户的数据层、RLS 和 Data API 权限 |
| S19 邀请制登录与 Supabase 云端归档 | 已完成 | [子 plan](./plans/2026-05-10-supabase-auth-archive.md) | 登录用户按 Supabase 账号保存归档，Cron 同时支持 Supabase 与旧 Upstash |
| S20 管理员邀请码管理页 | 已完成 | [子 plan](./plans/2026-05-10-invite-admin-page.md) | 在偏好设置中创建、查看和撤销邀请码 |
| S21 账号级管理员权限 | 已完成 | [子 plan](./plans/2026-05-10-account-admin-permissions.md) | 用 Supabase 账号角色管理邀请，私有访问码只做首个管理员初始化 |
| S22 账号额度与扫描访问闭环加固 | 已完成 | [子 plan](./plans/2026-05-10-quota-auth-audit.md) | 强制钱包上限，允许登录用户扫描，减少过期登录态和超额同步失败 |
| S23 管理员用户管理 | 已完成 | [子 plan](./plans/2026-05-10-admin-user-management.md) | 管理员查看用户、调整钱包上限、启用或禁用账号 |
| S24 用户级飞书通知配置 | 已完成 | [子 plan](./plans/2026-05-10-user-feishu-settings.md) | 每个登录用户独立配置飞书机器人，Cron 优先按用户配置提醒 |
| S25 取消全局飞书 Webhook | 已完成 | [子 plan](./plans/2026-05-10-personal-feishu-only.md) | 飞书只走个人 Webhook，未配置时不兜底发送 |
| S26 飞书真实数据测试发送 | 已完成 | [子 plan](./plans/2026-05-10-real-data-feishu-test.md) | 测试发送读取真实归档并跑每日刷新演练 |
| S27 账号归档隔离加固 | 已完成 | [子 plan](./plans/2026-05-10-account-archive-isolation.md) | 新账号空归档不再继承浏览器本地钱包缓存 |
| S28 系统审查与权限边界加固 | 已完成 | [子 plan](./plans/2026-05-10-system-audit-hardening.md) | 从安全、账号隔离、Cron 可靠性和默认数据泄露继续加固 |
| S29 会话与快照窗口审查 | 已完成 | [子 plan](./plans/2026-05-10-session-window-audit.md) | 加固登录态边界，统一当前快照日 10 日窗口统计口径 |
| S30 用量限制与规模边界审查 | 已完成 | [子 plan](./plans/2026-05-10-usage-limit-scale-audit.md) | 让刷新/重扫用量限制真实生效，修复归档规模和候选交易边界 |
| S31 规则版本化与 X Layer 接入 | 已完成 | [子 plan](./plans/2026-05-12-rule-versioning-xlayer.md) | 新旧规则按交易时间共存，钱包结果合并 BNB Chain 与 X Layer |
| S32 快照日期实时默认值修复 | 已完成 | [子 plan](./plans/2026-05-12-snapshot-today-default.md) | 刷新网页默认回到当前 UTC 快照日，避免旧归档日期覆盖 |
| S33 扫描结果立即云端保存 | 已完成 | [子 plan](./plans/2026-05-12-immediate-archive-save.md) | 扫描成功后立即写入 Supabase/服务端归档，降低刷新丢数据风险 |
| S34 Supabase 归档读取瘦身 | 已完成 | [子 plan](./plans/2026-05-12-supabase-archive-read-slim.md) | 先读轻量索引，再只拉每个钱包需要展示的结果 JSON |
| S35 禁用私有访问码归档回退 | 已完成 | [子 plan](./plans/2026-05-12-disable-access-code-archive-fallback.md) | 云端归档只认 Supabase 登录，私有访问码仅用于未登录扫描 |
| S36 Supabase 归档恢复后被清空修复 | 已完成 | [子 plan](./plans/2026-05-13-preserve-supabase-archive-records.md) | 修复钱包列表同步把云端 archive 结果重置为空的问题 |
| S37 xBETH / USDt0 基础倍数特例 | 已完成 | [子 plan](./plans/2026-05-13-xbeth-usdt0-rule-fix.md) | 修复 xBETH / USDt0 被误按 X Layer 普通代币 `0.5x` 计算的问题 |
| S38 本地刷新新增 Ankr 配置加载修复 | 已完成 | [子 plan](./plans/2026-05-13-local-ankr-env-fallback.md) | 修复本地刷新新增时 `/api/ankr` 未读取已有 Ankr 配置的问题 |
| S39 刷新增量并发写回防回退 | 已完成 | [子 plan](./plans/2026-05-13-refresh-writeback-rollback-fix.md) | 防止旧 records、并发写回、本地缓存覆盖最新 Supabase 快照 |
| S40 全局刷新与单钱包刷新一致性 | 已完成 | [子 plan](./plans/2026-05-13-global-refresh-consistency.md) | 修复全局刷新触发 Ankr 限流后保存 BSC-only 半成品的问题 |
| S41 交易明细完整性加固 | 已完成 | [子 plan](./plans/2026-05-13-transaction-detail-completeness.md) | 防止候选 hash 已发现但交易明细解析残缺的结果写入归档 |
| S42 飞书每日快照日报 | 已完成 | [子 plan](./plans/2026-05-14-feishu-daily-digest.md) | 飞书开启后每日发送快照日报，安全状态也有推送 |
| S43 OKB / USDt0 基础倍率特例 | 已完成 | [子 plan](./plans/2026-05-24-okb-usdt0-rule-fix.md) | 修复 X Layer 原生 OKB 与 USDt0 交易被误按 `0.5x` 计算的问题 |
| S44 X Layer 索引失败归档复用 | 已完成 | [子 plan](./plans/2026-05-30-xlayer-index-archive-reuse.md) | X Layer 钱包索引不可用时沿用可兼容原归档，其他链可继续增量刷新 |
| S45 OKX X Layer Explorer API 索引兜底 | 已完成 | [子 plan](./plans/2026-05-30-okx-xlayer-explorer-fallback.md) | Ankr X Layer 索引不可用时改用 OKX 官方地址交易索引 |
| S46 X Layer 增量链上兜底与旧归档误报修复 | 已完成 | [子 plan](./plans/2026-05-31-xlayer-incremental-rpc-fallback.md) | 索引失败时对小范围增量低速链扫，失败时不再把旧归档写成成功 |
| S47 钱包详情每日数据窗口口径修复 | 已完成 | [子 plan](./plans/2026-05-31-wallet-detail-date-window.md) | 详情页每日数据、加成和交易明细按当前快照日窗口展示 |

## 执行原则

1. `docs/requirements.md` 只记录用户需求，Agent 不主动修改。
2. `docs/plan.md` 只保留最少必要描述，详细内容放到子 plan。
3. 每个阶段有独立子 plan，描述实现边界、步骤和验收标准。
4. 每次代码改动后，Agent 必须同步更新 `docs/plan.md` 和对应子 plan 的状态。
