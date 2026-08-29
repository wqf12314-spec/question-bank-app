# V2 本地可靠性与审核证据

日期：2026-08-29。以下均为本机独立测试 PostgreSQL、`127.0.0.1:6380` Redis 和 `127.0.0.1:9000` MinIO 的可重复证据，不代表线上 Sentry、S3/R2、staging 或生产环境。

## 本轮实现

- 审核上传：`UploadPanel` 可选 `review-v1`，任务进入 `WAITING_REVIEW` 后读取审核预览；编辑者可修正草稿、明确采纳本地确定性建议，管理员可发布或整批回滚。建议只在审核接口返回，采纳复用带 `REVIEW_SUGGESTION_ACCEPTED` 原因的 Questions PATCH；请求统一经过既有 `apiFetch`。这不是 AI/OCR 输出。
- 导入校验：顶层 JSON Schema 只判断文件容器；单题使用独立 Ajv schema，因此一条坏题进入逐项失败报告，合法题仍可成为 `PARTIAL`。顶层 schema 错误稳定返回 `Invalid question bank schema`。
- 隐私遥测：Web 与 Electron 共用 `TelemetrySettings.vue`；默认关闭。本地错误记录保留 route/release/requestId，行为记录只保留事件元数据。递归清洗 answer/content/token/password/cookie 等敏感字段。
- 本地错误关联：Vite 构建注入 release；前端本地记录 release，API 使用 Pino JSON 日志携带 requestId。未配置 Sentry DSN，也没有伪造远程事件。
- MinIO multipart ETag：`npm run test:minio:etag` 上传两个真实分片，验证 ETag `87ba9c9d2e69480fe31b834308ef08dc-2` 与整文件 MD5 `94394a093d0b2ee3f390c7c97cc9fd69` 不同。
- 跨用户物理去重：服务端完整校验后才复用物理键；每位用户仍有独立 `FileObject`，完成响应去除 objectKey/bucket/ownerId。filesystem E2E 验证第二位用户仍可完成导入。
- MinIO 超时恢复：本地一次性延迟代理让首个 UploadPart 在 50 ms 预算内超时；服务器不写入该片，重试同一会话后成功合并并通过 SHA-256 校验。
- Redis 锁边界：`docs/adr/0004-redis-lock-boundary.md` 与 12 路并发 ImportJob E2E 表明当前由唯一约束、事务、幂等键和乐观锁仲裁；不额外引入业务分布式锁。

## 验证结果

- 前端 Node 单测：81/81。
- 后端单测：12/12。
- 后端 HTTP E2E：68/68（app 62/62 + MinIO 6/6）；包含顶层 schema FAILED、单题非法 PARTIAL、审核预览/建议人工采纳/逐项 PATCH/整批回滚、跨用户物理去重、超时后分片恢复、PDF/PNG Draft 提取和权限 403。
- Worker 集成：5/5；含 Redis 故障降级与 Worker stalled 恢复。
- MinIO E2E：6/6。
- Playwright 管理员审核闭环：1/1；上传 -> WAITING_REVIEW -> 页面修正 -> 发布 -> 刷新验证。
- Web 与 Electron renderer 构建：通过。

## 未覆盖边界

- 外部 Sentry、线上 release 关联、GitHub Actions 线上成功、staging/生产发布和生产迁移均未验证。
- 预签名 URL、对象存储流式 Hash 等代码已有本地 MinIO 证据，但面试星标理解验收不由自动化替代。
- PDF 文字层和预置英文 PNG OCR 已完成本地提取/Draft/失败路径验证；扫描 PDF OCR、其他 OCR 语言、真实模型 token/费用、语义 embedding 与版权人工审查仍未完成。
