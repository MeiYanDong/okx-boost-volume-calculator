# S38 本地刷新新增 Ankr 配置加载修复

## 目标

修复本地网页点击「刷新新增交易」时，服务端 `/api/ankr` 没有读取已有 Ankr 多链配置，导致 X Layer 交易发现失败的问题。

## 根因

本地 `npm run dev` 使用 Vite 的 `development` 模式，只加载 `.env.local`。当前 Ankr 多链配置存在于生产本地环境文件中，因此开发服务启动后 `ANKR_MULTICHAIN_RPC_URL` 为空。直接全量加载生产环境文件又会带入 `VERCEL` 等运行时标记，导致本地 API 被误判为生产环境。

## 实现

1. 本地开发模式下，从生产本地环境文件补齐服务配置。
2. 只允许 RPC、Ankr、Explorer、Supabase、KV、Cron 等必要配置作为本地 fallback。
3. 不继承 `VERCEL`、`VERCEL_ENV` 等运行时标记，避免本地服务误判生产运行环境。

## 验收

1. 本地 `/api/ankr` 能读取 X Layer 钱包索引。
2. 本地页面刷新后正常加载。
3. `npm run build` 通过。
