# Vercel 私人部署交接说明

这份文档给操作项目的 Agent 看。目标是把 OKX Boost 钱包总览工具部署成私人可用的 Vercel 版本，同时保护 Ankr、Chainstack、Explorer、飞书 Webhook 和访问密码。

## 部署目标

1. 前端页面部署到 Vercel。
2. `/api/rpc`、`/api/ankr`、`/api/explorer`、`/api/feishu` 通过 Vercel Functions 转发。
3. 所有付费服务地址和密钥只放在 Vercel 环境变量里。
4. 如果设置了 `ACCESS_PASSWORD`，用户必须在页面的钱包导入面板里填写私有访问码，扫描接口才会工作。
5. 生产站可以给少数可信用户使用，但不应公开传播。

## 环境变量职责

必须理解这些变量的分工：

| 变量 | 作用 | 建议 |
| --- | --- | --- |
| `ANKR_MULTICHAIN_RPC_URL` | Ankr Advanced 钱包交易索引，用来快速发现钱包 OKX 交易 hash | 优先配置 |
| `BSC_RPC_URL` | BNB Chain 标准 RPC，用来查区块、交易、receipt、logs、token 信息 | 建议用 Chainstack |
| `ETHERSCAN_API_KEY` | Explorer 钱包交易索引备选 | 可选；免费计划可能不支持 BSC |
| `ACCESS_PASSWORD` | 私人访问码，保护 API 额度 | 私人部署必须配置 |
| `FEISHU_WEBHOOK_URL` | 飞书自定义机器人 Webhook，用于发送快照风险提醒 | 可选；只放服务端环境变量 |
| `FEISHU_WEBHOOK_SECRET` | 飞书机器人签名密钥 | 可选；机器人开启签名校验时配置 |

推荐链路：

```text
Ankr：负责找交易
Chainstack：负责解析交易和 RPC 兜底
Explorer：备选索引，不作为主依赖
```

## Agent 部署步骤

1. 确认当前目录已经关联正确的 Vercel 项目。
2. 检查 Vercel Production、Preview、Development 三套环境变量是否都有必要变量。
3. 如果变量缺失，补齐项目级环境变量，不要把密钥写进代码或文档。
4. 本地先运行类型检查和生产构建。
5. 发起 Vercel Production 部署。
6. 部署完成后记录生产 URL。
7. 做 API 保护验证。
8. 做 Ankr 钱包索引验证。
9. 做页面加载验证。
10. 如果配置了飞书 Webhook，做一次快照预警发送验证。

## 验证标准

部署完成后，至少完成这些检查：

1. 生产页面可以打开。
2. 不带访问码请求 `/api/rpc` 会返回拒绝访问。
3. 带正确访问码请求 `/api/ankr` 能返回 BSC 钱包交易索引结果。
4. 带正确访问码请求 `/api/rpc` 能返回最新区块。
5. 页面能正常进入钱包总览。
6. 页面不会要求用户填写 Ankr、Chainstack 或 Etherscan 密钥。
7. 如果配置了飞书 Webhook，页面只在快照预测存在风险时显示飞书提醒按钮。
8. 飞书 Webhook 只允许 `open.feishu.cn` 或 `open.larksuite.com` 的官方机器人地址。

## 私人部署边界

这个版本适合本人或少数可信用户使用。

不要公开发布没有访问保护的链接。公开后，别人可以消耗你的 Ankr、Chainstack 或 Explorer 额度。

如果要公开给大量用户使用，下一阶段必须增加：

1. 登录账号。
2. 用户级限流。
3. 服务端缓存。
4. 扫描任务队列。
5. 使用日志。
6. 额度监控。

## 常见问题

### 为什么有 Chainstack 还要 Ankr？

Chainstack 是标准 RPC，适合解析交易和兜底扫 logs；Ankr Advanced 提供钱包交易索引，适合快速找到某个钱包的交易 hash。

两者不是二选一。最优组合是 Ankr 找交易，Chainstack 解析交易。

### 为什么 Explorer 会失败？

当前 Etherscan V2 免费 API 可能不支持 BSC 全链覆盖。如果页面提示 Explorer 失败，只要 Ankr 或 RPC 兜底成功，结果仍可继续计算。

### 为什么今天会提示实时预估？

如果快照日期是今天，UTC 今天还没结束，工具只能扫描到当前最新区块。后面继续交易会改变结果。

### 为什么刷新比重扫快？

刷新会使用本地归档和 `scannedToBlock`，只补扫新区块。重扫会重建整个 10 天窗口。

### Vercel 更新代码会不会换链接？

不会。只要继续使用同一个 Vercel 项目和同一个生产别名，更新代码后生产链接不变。不要把一次性 deployment URL 当成长期入口，长期入口应该使用项目的稳定 alias 或自定义域名。

### 飞书提醒怎么配置？

在飞书群里添加自定义机器人，复制 Webhook 到 `FEISHU_WEBHOOK_URL`。如果机器人安全设置启用了签名校验，把签名密钥放到 `FEISHU_WEBHOOK_SECRET`。

不要把 Webhook 或签名密钥写进前端代码、README 或提交记录。线上只放在 Vercel 环境变量里。
