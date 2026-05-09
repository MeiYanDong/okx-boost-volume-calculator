# Plan 纲领

> 维护规则：本文由 Agent 维护。每次完成代码改动后，必须同步更新本文状态，并保持对子 plan 的索引。

## 当前阶段

S16：服务端归档与每日自动刷新已完成。

S16 已接入 Upstash Redis 服务端归档、Vercel Cron 每日自动增量刷新和飞书风险提醒。生产稳定链接已验证，未授权 API 访问会被拒绝。S3 带访问码的线上 Ankr/RPC 烟测仍等待当前访问码。

子 plan：[S16 服务端归档与每日自动刷新](./plans/2026-05-09-server-cron-refresh.md)

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

## 执行原则

1. `docs/requirements.md` 只记录用户需求，Agent 不主动修改。
2. `docs/plan.md` 只保留最少必要描述，详细内容放到子 plan。
3. 每个阶段有独立子 plan，描述实现边界、步骤和验收标准。
4. 每次代码改动后，Agent 必须同步更新 `docs/plan.md` 和对应子 plan 的状态。
