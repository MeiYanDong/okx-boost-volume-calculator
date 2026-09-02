# Vercel 私人部署交接说明

这份文档给操作项目的 Agent 看。目标是把 OKX Boost 钱包总览工具部署成私人可用的 Vercel 版本，同时保护 Ankr、Chainstack、Explorer、用户级飞书 Webhook 和访问密码。

## 部署目标

1. 前端页面部署到 Vercel。
2. `/api/rpc`、`/api/ankr`、`/api/explorer`、`/api/feishu`、`/api/feishu-sync`、`/api/auth`、`/api/archive`、`/api/cron/daily-refresh` 通过 Vercel Functions 转发。
3. 所有付费服务地址和密钥只放在 Vercel 环境变量里。
4. 如果设置了 `ACCESS_PASSWORD`，未登录用户必须在钱包管理页填写私有访问码，扫描接口才会工作；已登录且 active 的 Supabase 用户可以直接扫描。
5. Supabase 保存邀请制账号、钱包归档、扫描结果和用户级飞书配置，避免重新部署后数据丢失。
6. Upstash Redis 继续作为旧版数据空间兼容路径。
7. Vercel Cron 每天北京时间 08:05 自动增量刷新上一 UTC 日快照。
8. 扫描归档保存和 Cron 刷新后，将本人工作区的 2026-06-18 起每日数据自动同步到飞书多维表格。
9. 生产站可以给少数可信用户使用，但不应公开传播。

## 环境变量职责

必须理解这些变量的分工：

| 变量 | 作用 | 建议 |
| --- | --- | --- |
| `ANKR_MULTICHAIN_RPC_URL` | Ankr Advanced 钱包交易索引，用来快速发现钱包 OKX 交易 hash | 优先配置 |
| `BSC_RPC_URL` | BNB Chain 标准 RPC，用来查区块、交易、receipt、logs、token 信息 | 建议用 Chainstack |
| `XLAYER_RPC_URL` | X Layer 标准 RPC，用来解析 X Layer 交易、receipt 和 token 信息 | 可选，默认 `https://rpc.xlayer.tech` |
| `OKX_XLAYER_API_KEY` | OKX X Layer Explorer API key，用来在 Ankr X Layer 钱包索引失败时读取地址普通交易列表 | 可选但建议配置 |
| `OKX_XLAYER_API_SECRET` | OKX X Layer Explorer API secret，用来服务端签名请求 | 可选但建议配置，只能放服务端 |
| `OKX_XLAYER_API_PASSPHRASE` | 创建 OKX X Layer Explorer API key 时填写的 passphrase | 可选但建议配置，只能放服务端 |
| `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` | OKX 控台常见命名，服务端会兼容映射到上面三项 | 可选；生产建议仍使用 `OKX_XLAYER_API_*` 前缀区分用途 |
| `OKX_XLAYER_EXPLORER_API_URL` | OKX X Layer Explorer 上游地址 | 可选，默认官方 `normal-transaction-list` 接口；只允许 `https://web3.okx.com/api/v5/xlayer/` |
| `ETHERSCAN_API_KEY` | Explorer 钱包交易索引备选 | 可选；免费计划可能不支持 BSC |
| `ACCESS_PASSWORD` | 私人访问码，保护未登录旧路径的 API 额度和首个管理员初始化 | 私人部署必须配置 |
| `CRON_SECRET` | 保护 Vercel Cron 自动刷新接口 | 私人部署必须配置 |
| `ACTIVE_CHAINS` | 服务端 Cron 当前扫描链，逗号分隔 | 默认 `xlayer`；只有恢复 BSC 业务时才设为 `bsc,xlayer` |
| `VITE_ACTIVE_CHAINS` | 浏览器手动刷新当前扫描链，逗号分隔 | 必须与 `ACTIVE_CHAINS` 一致，默认 `xlayer` |
| `RPC_USAGE_PAUSED` | 暂停本项目所有 RPC/Ankr/Explorer 上游调用 | 可选，设为 `true` 时扫描接口直接返回 503，Cron 直接跳过 |
| `ADMIN_ONLY_USAGE` | 仅允许管理员账号使用扫描、刷新和上游索引功能 | 可选，设为 `true` 时普通用户和私有访问码旧路径不能扫描；Cron 只刷新 admin workspace |
| `SUPABASE_URL` | Supabase 项目地址，用于账号和云端归档 | 多用户部署必须配置 |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key 或 legacy anon key，用于登录校验 | 多用户部署必须配置；配置后必须实际请求验证 |
| `SUPABASE_SECRET_KEY` | Supabase secret/service key 或 legacy service_role key，只能放服务端 | 多用户部署必须配置；配置后必须实际请求验证 |
| `FEISHU_APP_ID` | 飞书自建应用 App ID，用于服务端写入多维表格 | 启用多维表格同步时必须配置，只能放服务端 |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret，用于获取 tenant token | 启用多维表格同步时必须配置，只能放服务端 |
| `FEISHU_BASE_TOKEN` | 目标多维表格 token | 默认 `PXI5bYvkuaY77dsyiVvcPioZnLR` |
| `FEISHU_BASE_TABLE_ID` | 目标数据表 ID | 默认 `tblYcRHoWbtFjWkw` |
| `FEISHU_BASE_SYNC_WORKSPACE_ID` | 允许同步的 Supabase workspace | 默认 `eb029218-1b74-4df3-a378-fe8537dfd727`，防止同步其他用户数据 |
| `FEISHU_BASE_SYNC_OWNER_EMAIL` | 允许同步的账号邮箱 | 默认 `myandong1@gmail.com` |
| `FEISHU_BASE_SYNC_START_DATE` | 同步开始日期 | 默认 `2026-06-18` |
| `FEISHU_BASE_SYNC_AUTH_MODE` | 飞书写入身份 | 生产设为 `user`，仅使用管理员授权 |
| `FEISHU_BASE_SYNC_DISABLED` | 临时关闭飞书多维表格同步 | 可选，设为 `true` 时关闭 |
| `KV_REST_API_URL` | Upstash Redis REST 地址，由 Vercel Marketplace 注入 | 自动配置 |
| `KV_REST_API_TOKEN` | Upstash Redis 写入 Token，由 Vercel Marketplace 注入 | 自动配置 |

当前生产业务默认只刷新 X Layer。历史 BSC 交易继续保存在既有快照中；新快照若仍有位于滚动窗口内的 BSC 归档交易，会沿用归档值，但不会请求 BSC RPC。

推荐链路：

```text
OKX X Layer Explorer API：主索引，按钱包读取 X Layer 普通交易列表
Ankr：仅作 X Layer 备选钱包索引；未配置或额度失效不会阻断 OKX Explorer
X Layer 公共 RPC：负责区块定位、交易和 receipt 解析
BSC RPC：仅在显式恢复 `bsc,xlayer` 活动链时使用
```

## Agent 部署步骤

1. 确认待发布提交已进入 GitHub `main`，并记录完整 commit SHA；禁止发布仅存在于本地或 Vercel Dashboard 的代码。
2. 确认该 SHA 的 `Quality / quality` GitHub check 为成功状态。
3. 确认当前目录已经关联正确的 Vercel 项目。
4. 检查 Vercel Production、Preview、Development 三套环境变量是否都有必要变量。
5. 确认 Supabase 变量已配置；如果仍需要旧归档兼容，再确认 Vercel Marketplace 已绑定 Upstash Redis。
6. 如果变量缺失，补齐项目级环境变量，不要把密钥写进代码或文档。补齐后实际请求 `/api/auth?action=me`，确认返回 `configured: true`。
7. 本地先运行类型检查和生产构建。
8. 发起 Vercel Production 部署。
9. 部署完成后记录生产 URL。
10. 做 API 保护验证。
11. 做 Ankr 钱包索引验证；如果配置了 OKX X Layer Explorer API，同时验证 `/api/explorer?chain=xlayer` 可返回 `code: "0"`。
12. 做页面加载验证。
13. 做 Supabase 邀请码创建、邀请注册、登录、`/api/archive` 读写验证；没有管理员账号时先用私有访问码创建首个管理员邀请码，之后用管理员登录态管理邀请。
14. 验证 active 登录用户不填写私有访问码也能调用 `/api/rpc`、`/api/ankr`、`/api/explorer`。
15. 验证普通用户超过钱包上限时，`/api/archive` 保存会返回 403。
16. 验证管理员可读取用户列表、调整钱包上限、禁用和重新启用用户。
17. 做 `/api/cron/daily-refresh?dryRun=1` 验证，确认不会真实发送飞书。
18. 验证登录用户可在偏好设置保存账号级飞书 Webhook，接口返回脱敏信息。
19. 如果配置了飞书 Webhook，只在确认要测试真实通知时再触发非 dry-run 请求。
20. 如果配置了飞书多维表格同步，先请求 `/api/feishu-sync?dryRun=1`，确认返回的 `workspaceId` 是本人 workspace，`created/updated` 符合预期。
21. dry-run 正常后再请求 `/api/feishu-sync` 做一次 2026-06-18 起补同步。
22. 记录 Vercel deployment ID、稳定生产 alias 和对应 Git commit SHA。
23. 按预期运行模式执行 smoke：暂停态使用 `npm run smoke:production -- --expect-paused`；只有明确恢复 RPC 后才允许使用非暂停态验证。

发布决策见 [ADR 0001](./adr/0001-repository-and-release-source-of-truth.md)。CI 成功只证明代码门禁通过，不替代 Vercel 部署回执、运行时 smoke 或飞书写入后的读取核对。

## 验证标准

部署完成后，至少完成这些检查：

1. 生产页面可以打开。
2. 不带访问码且未登录请求 `/api/rpc` 会返回拒绝访问。
3. 带正确访问码请求 `/api/ankr` 能返回 BSC 钱包交易索引结果。
4. 带正确访问码请求 `/api/rpc` 能返回最新区块。
5. 如果配置了 OKX X Layer Explorer API，带正确访问码请求 `/api/explorer?chain=xlayer` 能返回 OKX 官方 X Layer 地址交易列表结构。
6. 登录 active 用户不填写私有访问码，也能调用 `/api/rpc`。
7. 页面能正常进入钱包总览。
8. 页面不会要求用户填写 Ankr、Chainstack、Etherscan 或 OKX X Layer API 密钥。
9. 飞书提醒只使用登录用户在偏好设置保存的个人 Webhook。
10. 飞书 Webhook 只允许 `open.feishu.cn` 或 `open.larksuite.com` 的官方机器人地址。
11. 登录用户刷新页面或 Vercel 重新部署后，钱包列表和已归档结果能从 Supabase `/api/archive` 恢复。
12. 登录用户超过钱包上限时，服务端拒绝保存归档，前端停止扫描和同步。
13. 管理员用户管理可查看用户、调整钱包上限、禁用和重新启用账号。
14. 禁用账号后，该账号不能继续调用受保护扫描接口。
15. Vercel Cron 配置为 `5 0 * * *`，对应北京时间 08:05。
16. Cron 请求必须通过 `CRON_SECRET` 或私有访问码验证。
17. `CRON_SECRET` 在用户管理 API 中只作为救援创建邀请码使用，不能直接列用户、撤销邀请码或修改用户。
18. Cron 对 Supabase 工作区只使用工作区所属用户的飞书配置；未配置时不发送飞书。
19. 飞书多维表格同步只允许写入 `FEISHU_BASE_SYNC_WORKSPACE_ID` 和 `FEISHU_BASE_SYNC_OWNER_EMAIL` 命中的本人数据。
20. 飞书多维表格同步只写 `日期`、`账户`、`代币`、`成交额`、`磨损（不算返佣）`、`Boost 倍数`、`加成`、`服务费`；不要修改公式字段、字段样式或小数位。
21. 如果 `RPC_USAGE_PAUSED=true`，`/api/rpc`、`/api/ankr`、`/api/explorer` 不得请求上游，`/api/cron/daily-refresh` 应返回 paused。
22. 如果 `ADMIN_ONLY_USAGE=true`，只有 active admin 登录态能调用 `/api/rpc`、`/api/ankr`、`/api/explorer` 和飞书真实数据测试；私有访问码不能绕过；Cron 只处理 admin workspace，不处理普通用户或旧 Upstash 空间。

## 私人部署边界

这个版本适合本人或少数可信用户使用。

不要公开发布没有访问保护的链接。公开后，别人可以消耗你的 Ankr、Chainstack 或 Explorer 额度。

如果要公开给大量用户使用，下一阶段必须增加：

1. 用户级限流。
2. 服务端缓存。
3. 扫描任务队列。
4. 使用日志。
5. 额度监控。
6. 管理员操作日志和额度监控。

## 常见问题

### 为什么有 Chainstack 还要 Ankr？

Chainstack 是标准 RPC，适合解析 BNB Chain 交易和兜底扫 logs；Ankr Advanced 提供钱包交易索引，适合快速找到某个钱包在 BNB Chain 和 X Layer 的交易 hash。

两者不是二选一。最优组合是 Ankr 找交易，标准 RPC 解析交易。X Layer 公共 RPC 不适合当作 10 天钱包扫链兜底；如果 Ankr 的 X Layer 钱包索引临时不可用，就用 OKX X Layer Explorer API 做地址交易索引兜底。

### 为什么 Explorer 会失败？

当前 Etherscan V2 免费 API 可能不支持 BSC 全链覆盖。如果页面提示 Explorer 失败，只要 Ankr 或 RPC 兜底成功，结果仍可继续计算。

### 为什么今天会提示实时预估？

如果快照日期是今天，UTC 今天还没结束，工具只能扫描到当前最新区块。后面继续交易会改变结果。

### 为什么刷新比重扫快？

刷新会使用本地归档和 `scannedToBlock`，只补扫新区块。重扫会重建整个 10 天窗口。

### Vercel 更新代码会不会换链接？

不会。只要继续使用同一个 Vercel 项目和同一个生产别名，更新代码后生产链接不变。不要把一次性 deployment URL 当成长期入口，长期入口应该使用项目的稳定 alias 或自定义域名。

### Vercel 重新部署后数据为什么不会丢？

浏览器本地归档仍然保留，但它不能被 Vercel Cron 读取。登录用户会把钱包列表、扫描结果、目标线和加成规则同步到 Supabase；未登录旧用户仍可用 Upstash Redis 数据空间。

重新部署只更新代码，不会清空 Supabase 或 Upstash。页面重新打开后会先读取 `/api/archive` 恢复云端归档，再继续本地缓存。

推荐隔离方式是 Supabase 账号。用户通过邀请码注册后，归档绑定自己的账号工作区。旧版兼容路径仍按钱包管理页的“数据空间码”隔离。`ACCESS_PASSWORD` 只保护未登录旧路径的 API 额度和首个管理员初始化，不是账号系统。

登录用户的 `max_wallets` 会在服务端保存归档时强制校验。普通用户默认 20 个钱包，管理员邀请码默认 200 个钱包；管理员可在创建邀请码时调整钱包上限。

Supabase key 配置后必须实测。若新式 `sb_publishable` / `sb_secret` 对 Data API 返回 `Invalid API key`，改用同项目的 legacy anon / service_role key。不要只看 Dashboard 上的 key 是否存在。

管理员登录后，可在偏好设置的用户管理卡片里查看用户列表、调整钱包上限、禁用或启用账号。为避免锁死管理入口，服务端会拒绝禁用当前管理员账号，也会拒绝禁用最后一个 active 管理员。

管理员初始化方式：当 Supabase 里还没有 active admin 时，进入偏好设置填写 `ACCESS_PASSWORD`，创建的邀请码会被强制设为管理员邀请码。用这个邀请码注册后，后续邀请码管理必须使用管理员账号登录态；`ACCESS_PASSWORD` 不再作为常规管理员权限。

为了兼容旧版本，默认数据空间 `default` 会读取旧的全局归档。新写入会进入按空间隔离的 v2 key。

### 每天自动刷新什么时候跑？

`vercel.json` 里的 Cron 是 `5 0 * * *`。这是 UTC 00:05，也就是北京时间 08:05。

这次运行确认的是上一 UTC 日快照。例如北京时间 2026-05-09 08:05 运行时，快照日是 `2026-05-08`，统计窗口是 `2026-04-29` 到 `2026-05-08`。

Cron 完成后会预测当前快照和未来 3 次快照。账号级配置里的“预测未来天数”会决定提醒判断范围。如果任一钱包在该范围内低于单钱包 10 日累计目标，或者自动刷新失败，才会发飞书。未配置个人飞书 Webhook 的用户不会收到飞书提醒。

### 飞书提醒怎么配置？

登录后进入“偏好设置 → 飞书通知”，保存自己的飞书自定义机器人 Webhook。如果机器人安全设置启用了签名校验，也保存签名密钥。前端只展示脱敏状态，不会读回 Webhook 原文。

不要把 Webhook 或签名密钥写进前端代码、README 或提交记录。线上只放在 Supabase 用户配置里。

### 飞书多维表格怎么自动同步？

服务端会在两个时机自动同步：

1. 登录用户保存云端归档后。
2. Vercel Cron 每天北京时间 08:05 增量刷新并保存归档后。

同步目标默认是多维表格 `每日交易量 综合 V3.0` 的表 `tblYcRHoWbtFjWkw`，从 `2026-06-18` 开始。同步键是 `日期 + 账户 + 代币`，所以重复执行会更新同一行，不会无脑追加。写入前会校验 workspace 和邮箱白名单，默认只允许 `eb029218-1b74-4df3-a378-fe8537dfd727` / `myandong1@gmail.com`。

手动补同步：

```bash
curl -X POST "$APP_ORIGIN/api/feishu-sync?dryRun=1" \
  -H "authorization: Bearer $ACCESS_PASSWORD"

curl -X POST "$APP_ORIGIN/api/feishu-sync" \
  -H "authorization: Bearer $ACCESS_PASSWORD"
```

同步只写存储字段，不写公式字段，也不改字段格式、小数位或样式。`成交额` 如果仍是文本字段，会写入可被公式识别的数字文本；如果之后手动改成数字字段，服务端会自动按数字写入。
