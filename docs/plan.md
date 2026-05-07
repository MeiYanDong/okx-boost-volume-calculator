# Plan 纲领

> 维护规则：本文由 Agent 维护。每次完成代码改动后，必须同步更新本文状态，并保持对子 plan 的索引。

## 当前阶段

S1：复刻参考图的钱包 Boost 工作台布局已完成。

当前进行中：S3 文档与部署同步。用户文档、Agent 部署文档和 Vercel 生产部署已同步；带访问码的线上 Ankr/RPC 烟测等待当前访问码。

子 plan：[S3 文档与部署同步](./plans/2026-05-07-docs-deploy-sync.md)

## 阶段索引

| 阶段 | 状态 | 子 plan | 目标 |
| --- | --- | --- | --- |
| S0 文档治理 | 已完成 | 本文与 todo 纲领 | 建立需求、plan、todo 分层规则 |
| S1 Dashboard Layout Rebuild | 已完成 | [子 plan](./plans/2026-05-07-dashboard-layout-rebuild.md) | 复刻参考图布局，保留 OKX Wallet 主题 |
| S2 交互与归档完善 | 已完成 | [子 plan](./plans/2026-05-07-interaction-archive-polish.md) | 完成核心扫描、归档、详情和加成工作流 |
| S3 文档与部署同步 | 进行中 | [子 plan](./plans/2026-05-07-docs-deploy-sync.md) | 完成文档更新和 Vercel 生产部署 |
| S4 小功能页面 | 待开始 | 待创建 | 开发侧边栏其余辅助页面 |

## 执行原则

1. `docs/requirements.md` 只记录用户需求，Agent 不主动修改。
2. `docs/plan.md` 只保留最少必要描述，详细内容放到子 plan。
3. 每个阶段有独立子 plan，描述实现边界、步骤和验收标准。
4. 每次代码改动后，Agent 必须同步更新 `docs/plan.md` 和对应子 plan 的状态。
