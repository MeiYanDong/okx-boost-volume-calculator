# S27 子 Todo：账号归档隔离加固

## 1. 前端数据源

- [x] Supabase 账号归档加载时禁止合并本地钱包缓存
- [x] Supabase 空归档时重置为空工作区
- [x] UI 本地缓存只在未登录模式写入
- [x] 登录账号不读写全局 result cache
- [x] 登录账号不写入全局 scan history

## 2. 同步保护

- [x] 增加当前归档上下文标识
- [x] 自动同步等待当前账号归档加载完成
- [x] 切换/注册账号时清空旧归档 ready 状态
- [x] 空钱包列表不触发无意义归档保存

## 3. 验证

- [x] `npm run lint`
- [x] `npm run build`
- [x] 生产部署和线上 smoke test
