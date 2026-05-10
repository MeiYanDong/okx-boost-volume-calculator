# S23 子 Todo：管理员用户管理

## 1. 后端

- [x] 新增 `listAdminUsers`
- [x] 新增 `updateAdminUser`
- [x] 用户列表返回工作区数量和钱包数量
- [x] 更新钱包额度时限制 1 到 500
- [x] 禁止禁用当前登录管理员
- [x] 禁止禁用最后一个 active 管理员
- [x] `/api/auth` 接入 `list-users`
- [x] `/api/auth` 接入 `update-user`

## 2. 前端

- [x] 增加管理员用户类型
- [x] 增加用户列表请求
- [x] 增加用户更新请求
- [x] 偏好设置页增加用户管理卡片
- [x] 展示邮箱、角色、状态、工作区数、钱包数和钱包额度
- [x] 支持保存钱包额度
- [x] 支持启用或禁用用户
- [x] 当前管理员禁用按钮置灰

## 3. 文档

- [x] 更新 `docs/plan.md`
- [x] 更新 `docs/todo.md`
- [x] 新增本阶段子 plan
- [x] 新增本阶段子 todo
- [x] 更新 README 用户管理说明
- [x] 更新 Vercel 私人部署交接说明

## 4. 验证

- [x] `npm run lint`
- [x] Node `.mjs` 语法检查
- [x] 真实 Supabase 管理员读取用户列表测试
- [x] 真实 Supabase 调整钱包额度测试
- [x] 真实 Supabase 禁用用户后扫描拒绝测试
- [x] 真实 Supabase 重新启用用户测试
- [x] 真实 Supabase 普通用户禁止管理测试
- [x] `npm run build`
- [x] 本地浏览器验证用户管理卡片
- [x] 生产部署和线上烟测
