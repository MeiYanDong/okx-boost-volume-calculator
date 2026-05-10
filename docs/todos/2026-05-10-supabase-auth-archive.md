# S19 子 Todo：邀请制登录与 Supabase 云端归档

## 1. 后端

- [x] 新增 Supabase 服务端封装
- [x] 新增 `/api/auth`
- [x] 支持创建邀请码
- [x] 支持邀请码注册
- [x] 支持邮箱密码登录
- [x] 支持 session 刷新和 `me` 校验
- [x] `/api/archive` 登录态走 Supabase
- [x] `/api/archive` 未登录态保留 Upstash
- [x] Cron 同时支持 Supabase 与 Upstash 工作区

## 2. 前端

- [x] 新增顶部账号入口
- [x] 支持登录
- [x] 支持邀请注册
- [x] 登录后使用 Supabase archive headers
- [x] 钱包管理页登录态隐藏数据空间码
- [x] 未登录且未填访问码时停止自动请求服务端归档

## 3. 数据库

- [x] 修复邀请码 used_by 删除时的约束冲突
- [x] 推送新增 migration 到 Supabase

## 4. 验证

- [x] `npm run lint`
- [x] Node `.mjs` 语法检查
- [x] 真实 Supabase 邀请注册、登录、归档保存、归档恢复测试
- [x] Playwright 验证账号入口和钱包管理页
