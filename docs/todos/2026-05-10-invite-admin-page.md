# S20 子 Todo：管理员邀请码管理页

## 1. 后端

- [x] `/api/auth` 增加 `list-invites`
- [x] `/api/auth` 增加 `revoke-invite`
- [x] 邀请码列表返回脱敏字段
- [x] 撤销只允许未使用的邀请码

## 2. 前端

- [x] 偏好设置页增加管理员私有访问码输入
- [x] 支持创建邀请码
- [x] 支持刷新最近邀请码列表
- [x] 支持撤销未使用的邀请码
- [x] 新邀请码原文只展示一次
- [x] 补齐中宽屏和移动端布局

## 3. 文档

- [x] 更新 Plan 纲领
- [x] 更新 Todo 纲领
- [x] 补充子 plan 和子 todo
- [x] 更新用户 README 和 Vercel 部署交接说明

## 4. 验证

- [x] `npm run lint`
- [x] Node `.mjs` 语法检查
- [x] `npm run build`
- [x] 本地 Supabase 管理 API 测试
