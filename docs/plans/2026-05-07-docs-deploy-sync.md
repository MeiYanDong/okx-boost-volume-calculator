# S3 子 Plan：文档与部署同步

## 阶段目标

把核心工作流完成后的项目状态同步到用户文档、Agent 交接文档和 Vercel 生产部署。

## 范围

本阶段包含：

1. 更新面向用户的 README。
2. 更新面向 Agent 的 Vercel 私人部署交接文档。
3. 检查 Vercel 环境变量。
4. 执行生产部署。
5. 验证生产页面和受保护 API。

本阶段不包含：

1. 修改 `docs/requirements.md`。
2. 新增公开用户系统。
3. 开发侧边栏小功能页面。

## 当前状态

进行中。生产部署已完成，页面和未授权 API 保护已验证；带访问码的 Ankr/RPC 线上烟测等待用户提供当前访问码。

已完成：

1. README 改写为当前产品说明。
2. Vercel 私人部署交接文档改写为当前 Ankr + Chainstack 架构。
3. Vercel Production 部署完成。
4. 生产页面打开验证通过。
5. 未带访问码时 API 拒绝访问验证通过。

## 验收标准

1. README 说明多钱包总览、增量刷新、强制重扫、代币加成和数据来源。
2. Vercel 文档说明 `ANKR_MULTICHAIN_RPC_URL`、`BSC_RPC_URL`、`ETHERSCAN_API_KEY`、`ACCESS_PASSWORD` 的职责。
3. `npm run lint` 通过。
4. `npm run build` 通过。
5. Vercel Production 部署成功。
6. 生产页面可打开。
7. 未带访问码时受保护 API 拒绝访问。
8. 带访问码时 `/api/ankr` 返回钱包索引结果。
9. 带访问码时 `/api/rpc` 返回 BNB Chain 最新区块。
