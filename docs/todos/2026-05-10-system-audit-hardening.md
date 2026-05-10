# S28 子 Todo：系统审查与权限边界加固

## 安全与权限

- [x] 生产环境缺少 `ACCESS_PASSWORD` 时拒绝私有 API
- [x] 生产环境缺少 `CRON_SECRET` 时拒绝 Cron
- [x] `validateAccess` 使用显式 env，避免测试和生产判断不一致
- [x] `CRON_SECRET` 只允许创建救援邀请码，不再允许列表和用户修改动作

## Cron 与归档

- [x] Cron 单工作区失败不影响后续工作区
- [x] Cron 保存失败和飞书发送失败写入响应，不吞掉错误
- [x] 指定 Supabase workspace 命中后不再额外扫描 Upstash
- [x] Supabase workspace 读取前校验 owner active 状态

## 前端与账号隔离

- [x] 移除默认真实钱包地址
- [x] 兼容清理旧版默认真实钱包缓存
- [x] 登录、注册、退出时清空当前钱包视图，避免同浏览器串号
- [x] “钱包额度”改为“钱包上限”
- [x] “有效天数”改为“邀请码有效期”

## 验证

- [x] `node --check server/proxy.mjs`
- [x] `node --check server/cronApi.mjs`
- [x] `node --check server/authApi.mjs`
- [x] `node --check server/supabaseStore.mjs`
- [x] `npm run lint`
- [x] `npm run build`
- [x] 权限 smoke test
- [x] Cron auth smoke test
- [x] Playwright 首页、钱包管理、偏好设置验证
