# S38 本地刷新新增 Ankr 配置加载修复 Todo

- [x] 打开「扫描记录」确认最近扫描区域
- [x] 复现本地 `/api/ankr` 返回 Ankr 未配置
- [x] 定位 `server.mjs` 只加载 development env 的问题
- [x] 增加生产本地服务配置 fallback
- [x] 排除 `VERCEL` 运行时标记，避免本地误判生产环境
- [x] 重启本地服务
- [x] 验证 `/api/ankr` 可返回 X Layer 钱包索引
- [x] 构建验证通过
