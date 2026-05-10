# S24 子 Todo：用户级飞书通知配置

## 1. 数据层

- [x] Supabase 增加 `notification_settings.feishu_secret`
- [x] 新增当前用户飞书配置读取能力
- [x] 新增当前用户飞书配置更新能力
- [x] 返回前端时脱敏 Webhook 和签名密钥

## 2. 后端

- [x] `/api/auth` 接入 `get-notification-settings`
- [x] `/api/auth` 接入 `update-notification-settings`
- [x] `/api/feishu` 优先使用登录用户配置
- [x] `/api/feishu` 保留全局 Webhook 兜底
- [x] Cron 对 Supabase 工作区优先使用所属用户配置
- [x] Cron 按用户配置的未来预测天数判断是否提醒

## 3. 前端

- [x] 偏好设置页新增飞书通知卡片
- [x] 支持启停账号级提醒
- [x] 支持保存 Webhook 和签名密钥
- [x] 支持设置预测未来天数
- [x] 支持测试发送
- [x] 手动风险提醒使用登录态调用 `/api/feishu`

## 4. 文档

- [x] 更新 `docs/plan.md`
- [x] 更新 `docs/todo.md`
- [x] 新增本阶段子 plan
- [x] 新增本阶段子 todo
- [x] 更新 README 飞书配置说明
- [x] 更新 Vercel 私人部署说明

## 5. 验证

- [x] `npm run lint`
- [x] Supabase 远程迁移
- [x] 本地 Node `.mjs` 语法检查
- [x] 本地真实 Supabase 飞书配置读写测试
- [x] 本地无效 Webhook 拒绝测试
- [x] 本地 `/api/auth` 飞书配置动作测试
- [x] `npm run build`
- [x] 本地浏览器验证飞书配置卡片
- [x] 生产部署和线上 smoke test
