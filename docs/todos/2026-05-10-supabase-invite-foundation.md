# S18 子 Todo：Supabase 邀请制基础设施

## 1. Supabase 项目

- [x] 在账户 2 的 `Supabase-1` 组织创建 `okx-boost`
- [x] 选择 Tokyo 区域
- [x] 关闭自动暴露新表
- [x] 开启自动 RLS
- [x] 验证 REST endpoint
- [x] 验证数据库 pooler 连接

## 2. 密钥与连接

- [x] 获取 publishable key
- [x] 获取 secret key
- [x] 将 DB 密码、publishable key、secret key 保存到本机 Keychain
- [x] 更新 `.env.example`

## 3. 数据库结构

- [x] 初始化 Supabase CLI 配置
- [x] 新增邀请制基础表 migration
- [x] 新增 Data API 最小权限 migration
- [x] 新增 checksum 地址兼容 migration
- [x] 推送 migration 到远端 Supabase
- [x] 验证所有业务表 RLS 已开启
- [x] 验证 anon 不能读业务表
- [x] 验证 secret key 可通过 REST 读业务表

## 4. 后续集成

- [ ] 接入 Supabase JS 客户端
- [ ] 实现邀请兑换 API
- [ ] 实现用户工作区 API
- [ ] 迁移现有默认归档
- [ ] 切换 Cron 归档来源
