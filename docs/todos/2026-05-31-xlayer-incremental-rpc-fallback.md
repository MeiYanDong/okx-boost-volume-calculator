# S46 X Layer 增量链上兜底与旧归档误报修复 Todo

- [x] 读取 12、13 钱包当前 Supabase 归档和 X Layer 检查点。
- [x] 用 X Layer RPC 从旧检查点直扫到最新区块，确认链上真实新增交易数量。
- [x] 增加 X Layer 小范围增量 RPC 兜底配置。
- [x] X Layer 浏览器端改为直连公开 RPC，并禁用公开 RPC 的认证头。
- [x] 生产 CSP 精确放行 X Layer 公开 RPC。
- [x] 将 RPC Transfer 扫描并发、topic 并发、请求延迟改为按链配置。
- [x] 对 X Layer 公开 RPC 429 限流使用更长退避。
- [x] BSC RPC 兜底按已知 Boost 代币地址过滤 Transfer 日志，适配拒绝全网日志的标准 RPC 节点。
- [x] X Layer RPC 兜底按 USDt0 / xBETH 过滤 Transfer 日志，减少无关日志负载。
- [x] 浏览器端 X Layer RPC 改走后端代理，避免公共 RPC 偶发 CORS 失败；服务端 Cron 仍直连 X Layer RPC。
- [x] 加固服务端运行时对浏览器 localStorage / cache storage 的判定，避免 Node 环境误用不可用存储。
- [x] 禁止旧归档未覆盖最新区块时写入伪成功结果。
- [x] 构建验证。
- [x] 核心逻辑使用生产归档刷新 12 钱包验证：X Layer 新增 28 笔，刷新成功。
- [x] 核心逻辑使用生产归档刷新 13 钱包验证：X Layer 新增 30 笔，刷新成功。
- [x] 生产环境网页刷新 12 钱包验证：X Layer 新增 28 笔并写入 Supabase。
- [x] 生产环境网页刷新 13 钱包验证：X Layer 新增 30 笔并写入 Supabase。
