# S25 子 Todo：取消全局飞书 Webhook

## 1. 后端

- [x] `/api/feishu` 移除私有访问码 + 全局 Webhook 路径
- [x] `/api/feishu` 未登录时返回 401
- [x] Cron 只读取 Supabase 工作区所属用户个人飞书配置
- [x] Cron 未配置个人 Webhook 时跳过通知

## 2. 前端

- [x] `发送测试` 消息不包含钱包地址、交易哈希或交易量
- [x] 真实钱包数据只通过风险提醒发送

## 3. 文档

- [x] 更新 README
- [x] 更新 Vercel 私人部署说明
- [x] 更新 `docs/plan.md`
- [x] 更新 `docs/todo.md`
- [x] 新增本阶段子 plan
- [x] 新增本阶段子 todo

## 4. 验证

- [x] `npm run lint`
- [x] Node `.mjs` 语法检查
- [x] 本地 `/api/feishu` 未登录拒绝测试
- [x] 本地个人飞书配置 API 测试
- [x] `npm run build`
- [x] 生产部署和线上 smoke test
