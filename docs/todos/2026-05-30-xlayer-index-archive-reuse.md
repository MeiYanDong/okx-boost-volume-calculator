# S44 X Layer 索引失败归档复用 Todo

- [x] 定位 X Layer 错误被误包装成 RPC 公开链上记录失败的问题。
- [x] 保持 X Layer 禁用 RPC Transfer 日志兜底。
- [x] 收集 Ankr / Explorer 钱包索引真实失败原因。
- [x] 可兼容窗口已有 X Layer 归档时，增量刷新沿用该链原归档。
- [x] 沿用旧链归档时，按当前快照窗口重新过滤交易和汇总每日数据。
- [x] 避免保存 BSC-only 缺链半成品。
- [x] 保持强制重扫的完整性要求。
- [x] 构建验证。
