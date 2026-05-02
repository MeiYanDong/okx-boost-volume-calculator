# Vercel 私人部署交接说明

这份说明给操作项目的 Agent 看。目标是把 OKX Boost 交易量计算器部署成私人可用的 Vercel 版本，不公开暴露付费 RPC 或 API Key。

## 部署目标

- 前端页面部署到 Vercel。
- 链上数据请求通过 Vercel API Functions 转发。
- Ankr、Etherscan、BSC RPC 等密钥只保存在 Vercel 环境变量中。
- 如果设置了访问码，用户必须在页面的“私有访问码”里填写后才能扫描。

## Agent 需要做什么

1. 在 Vercel 中创建或关联这个 GitHub 项目。
2. 在 Vercel Project Settings 的 Environment Variables 中配置：
   - `ANKR_MULTICHAIN_RPC_URL`
   - `ETHERSCAN_API_KEY`
   - `BSC_RPC_URL`
   - `ACCESS_PASSWORD`
3. 部署 Preview，打开页面做一次真实钱包扫描。
4. 确认页面可以读取 BNB Chain OKX 聚合交易，且结果能正常展示。
5. 确认不填写“私有访问码”时，扫描会被拒绝；填写正确访问码后，扫描可以继续。
6. Preview 没问题后，再提升为 Production。

## 私人部署边界

这个版本适合本人或少数可信用户使用。

不要把没有访问保护的链接公开发布，因为别人可以消耗部署者的 Ankr、Etherscan 或 RPC 额度。

如果要公开给大量用户使用，下一步应该增加账号登录、限流、服务端缓存和使用日志。
