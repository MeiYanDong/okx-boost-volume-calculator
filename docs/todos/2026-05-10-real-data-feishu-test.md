# S26 子 Todo：飞书真实数据测试发送

## 1. 后端

- [x] 新增真实数据测试消息生成模块
- [x] `/api/feishu` 支持 `mode: "real-data-test"`
- [x] 真实数据测试要求登录用户个人 Webhook
- [x] 真实数据测试复用每日自动刷新逻辑
- [x] 测试演练不写入归档
- [x] `BSC_RPC_URL` 为空时从 Ankr Multichain 推导 Ankr BSC 标准 RPC
- [x] 规范化 Ankr URL，避免尾部 `/n` 导致 RPC 404

## 2. 前端

- [x] “发送测试”改为发送真实数据测试
- [x] 设置页文案说明测试和每日 Cron 都只使用当前账号配置
- [x] 发送状态提示改为真实归档演练

## 3. 部署

- [x] `api/feishu.mjs` 配置 300 秒 Vercel 函数时长
- [x] 更新 README
- [x] 更新 `docs/plan.md`
- [x] 更新 `docs/todo.md`

## 4. 验证

- [x] `npm run lint`
- [x] Node `.mjs` 语法检查
- [x] `npm run build`
- [x] 生产部署和线上 smoke test
