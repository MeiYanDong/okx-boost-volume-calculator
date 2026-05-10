# Plan 纲领

> 维护规则：本文由 Agent 维护。每次完成代码改动后，必须同步更新本文状态，并保持对子 plan 的索引。

## 当前阶段

S28：系统审查与权限边界加固已完成。

S28 从账号隔离、生产密钥、Cron、多用户通知和前端默认数据几个维度继续审查。已修复生产缺密钥时误放行、Cron 单工作区失败拖垮全局、禁用账号 workspace 被请求扫描、`CRON_SECRET` 管理权限面过宽，以及默认真实钱包地址泄露/同浏览器退出后串号的问题。

子 plan：[S28 系统审查与权限边界加固](./plans/2026-05-10-system-audit-hardening.md)

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

## 执行原则

1. `docs/requirements.md` 只记录用户需求，Agent 不主动修改。
2. `docs/plan.md` 只保留最少必要描述，详细内容放到子 plan。
3. 每个阶段有独立子 plan，描述实现边界、步骤和验收标准。
4. 每次代码改动后，Agent 必须同步更新 `docs/plan.md` 和对应子 plan 的状态。
