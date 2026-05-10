# S21 子 Todo：账号级管理员权限

## 1. 后端

- [x] `GET /api/auth?action=me` 返回角色信息
- [x] 登录 session 合并 profile 角色
- [x] 刷新 session 合并 profile 角色
- [x] 管理接口优先校验 admin 登录态
- [x] 无 active admin 时允许私有访问码初始化首个管理员
- [x] 已有 active admin 后拒绝私有访问码直接管理邀请

## 2. 前端

- [x] Auth session 支持 `role`、`status`、`maxWallets`
- [x] 顶部账号显示 Admin 标识
- [x] 邀请码管理支持选择普通用户或管理员
- [x] 登录 admin 后隐藏私有访问码依赖
- [x] 首个管理员初始化文案明确

## 3. 验证

- [x] `npm run lint`
- [x] Node `.mjs` 语法检查
- [x] 真实 Supabase 首个管理员初始化测试
- [x] 真实 Supabase 管理员登录态邀请码测试
- [x] 真实 Supabase 私有访问码降权测试
- [x] 清理测试用户和邀请码后复查数据库
