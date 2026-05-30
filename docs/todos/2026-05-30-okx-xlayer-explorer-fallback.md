# S45 OKX X Layer Explorer API 索引兜底 Todo

- [x] 确认 OKX X Layer API 的认证头、签名规则和地址普通交易列表接口。
- [x] 给 X Layer 增加 `okx-xlayer` Explorer 索引格式。
- [x] 在服务端 `/api/explorer?chain=xlayer` 实现 OKX 签名代理。
- [x] 限制 OKX Explorer 上游域名，避免密钥发往非官方地址。
- [x] 解析 OKX `transactionList` 并映射到内部交易结构。
- [x] 让 Cron 能通过同源代理使用 X Layer Explorer 兜底。
- [x] 更新私人部署文档和用户 README。
- [x] 构建验证。
