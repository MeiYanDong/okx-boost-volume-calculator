# S28 子 Plan：系统审查与权限边界加固

## 目标

从安全、账号隔离、Cron 可靠性、默认数据和 RPC 路径几个维度继续审查，把会影响多用户生产使用的问题修掉。

## 实现边界

1. 生产环境缺少 `ACCESS_PASSWORD` 或 `CRON_SECRET` 时必须 fail closed。
2. Cron 遍历多工作区时，单个工作区失败不能中断其他用户。
3. 指定 workspace 刷新时，Supabase 命中后不再继续查旧 Upstash 空间。
4. Supabase workspace 读取阶段就校验 owner 仍为 active，避免禁用账号消耗扫描额度。
5. `CRON_SECRET` 只保留创建救援邀请码能力，不再直接列用户、撤销邀请码或修改用户。
6. 新访客默认不展示任何真实钱包地址；登录、注册、退出时清空当前钱包视图，避免同浏览器串号。
7. “钱包额度”文案统一改为“钱包上限”，“有效天数”明确为“邀请码有效期”。

## 验收标准

1. `npm run lint` 通过。
2. `npm run build` 通过并生成 `.server/cronJob.mjs`。
3. 本地 smoke test 验证生产缺密钥不放行、访问码仍可用、`CRON_SECRET` 不能直接执行用户管理。
4. Playwright 验证默认首页和钱包管理页均为 0 钱包，不出现历史真实钱包地址。
5. Playwright 验证偏好设置展示“钱包上限”和“邀请码有效期”。

## 状态

已完成。
