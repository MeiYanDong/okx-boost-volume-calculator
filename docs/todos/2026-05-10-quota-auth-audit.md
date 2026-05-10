# S22 子 Todo：账号额度与扫描访问闭环加固

## 1. 审查

- [x] 审查扫描代理访问控制
- [x] 审查 Supabase 归档保存权限
- [x] 审查邀请码额度字段是否真正生效
- [x] 审查前端超额反馈和自动同步行为
- [x] 审查长开页面登录态过期风险

## 2. 后端

- [x] `/api/rpc` 支持 active Supabase 登录态访问
- [x] `/api/ankr` 支持 active Supabase 登录态访问
- [x] `/api/explorer` 支持 active Supabase 登录态访问
- [x] Supabase 用户读取归档时校验账号 active 状态
- [x] Supabase 用户保存归档时强制校验钱包额度
- [x] Cron 保存 Supabase 工作区归档时强制校验账号 active 状态和钱包额度
- [x] 邀请码默认额度按账号角色区分
- [x] `CRON_SECRET` 管理入口不再被误当成 Supabase JWT

## 3. 前端

- [x] 受保护扫描请求未填私有访问码时自动使用登录 token
- [x] 钱包管理页展示账号钱包额度
- [x] 超出钱包额度时禁用刷新新增交易
- [x] 超出钱包额度时禁用强制重扫全部
- [x] 超出钱包额度时停止自动同步服务端归档
- [x] 页面长时间打开时自动刷新 Supabase 登录态
- [x] 管理员邀请码表单支持最高 500 个钱包额度

## 4. 文档

- [x] 更新 `docs/plan.md`
- [x] 更新 `docs/todo.md`
- [x] 新增本阶段子 plan
- [x] 新增本阶段子 todo
- [x] 修正 README 中登录用户和私有访问码的关系
- [x] 修正 Vercel 私人部署验证标准

## 5. 验证

- [x] `npm run lint`
- [x] Node `.mjs` 语法检查
- [x] 真实 Supabase 登录态扫描代理测试
- [x] 真实 Supabase 钱包额度 403 测试
- [x] 真实 Supabase 归档成功写入测试
- [x] 清理测试用户、工作区和邀请码后复查数据库
- [x] `npm run build`
- [x] 本地浏览器验证钱包管理页和邀请码额度表单
- [ ] 生产部署和线上烟测
