# S45 OKX X Layer Explorer API 索引兜底

## 背景

X Layer 不能用公共 RPC 长窗口扫 Transfer 日志作为兜底。上一阶段已经避免在 Ankr `xlayer` 索引不可用时写入缺链半成品，但这只能复用已有归档，不能发现新 X Layer 交易。

OKX 官方 X Layer on-chain data API 提供地址普通交易列表，并要求服务端用 `OK-ACCESS-*` 头签名。因此最优解是保留 Ankr 作为首选索引，同时把 OKX X Layer Explorer API 接成服务端兜底索引。

## 实现

1. X Layer 链配置增加 `/api/explorer?chain=xlayer`，索引格式为 `okx-xlayer`。
2. `/api/explorer?chain=xlayer` 在服务端读取 `OKX_XLAYER_API_KEY`、`OKX_XLAYER_API_SECRET`、`OKX_XLAYER_API_PASSPHRASE`，按 OKX 官方签名规则请求 `normal-transaction-list`。
3. OKX API key、secret、passphrase 只走服务端环境变量，不进入前端 bundle、日志或文档。
4. 上游地址只允许 `https://web3.okx.com/api/v5/xlayer/`，避免把签名头发给非官方域名。
5. 前端 Explorer 解析器兼容 OKX 返回的 `code/msg/data/transactionList` 结构，并映射成项目内部交易结构。
6. Ankr X Layer 索引失败后，自动尝试 OKX X Layer Explorer API；两者都不可用时仍保留 S44 的归档复用保护。
7. 每日 Cron 通过当前站点 origin 调用同源 `/api/explorer?chain=xlayer`，并携带服务端访问码，避免 Cron 因没有浏览器登录态而无法使用 X Layer Explorer 兜底。

## 验收

1. 没有 OKX X Layer API 环境变量时，错误明确提示 `OKX X Layer Explorer API is not configured`，不会泄露密钥。
2. 配置 OKX X Layer API 后，X Layer 在 Ankr `No nodes available` 时仍能发现新增 OKX Router 交易 hash。
3. 每日 Cron 和手动刷新使用同一套 X Layer 兜底索引逻辑。
4. OKX API 签名只在服务端完成，浏览器网络请求中不出现 OKX key。
5. `npm run build` 通过。
