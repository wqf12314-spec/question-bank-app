# 本地 MinIO 对象存储闭环证据

生成日期：2026-08-29

## 可重复命令

```powershell
npm run test:minio
cd server
npm run test:e2e:minio -- --runInBand
npm run build
npx prisma validate
```

测试使用本机 `127.0.0.1:9000` 的官方 MinIO Windows 进程和独立 PostgreSQL 测试库；未连接正式 Neon、R2 或 AWS S3。

本轮复核结果：`server/test/object-storage.e2e-spec.ts` 为 6/6，后端 HTTP E2E 合计为 64/64（app 58/58 + MinIO 6/6），前端 Node 单测为 80/80，Worker 集成测试为 5/5；Web、Electron renderer、NestJS/Worker 构建和 Prisma validate 均通过。

## 已验证

- 创建真实 Multipart Upload，将 `bucket`、`uploadId`、`storageBackend` 保存进 `UploadSession`。
- 返回 `sessionId`、8 MiB `partSize`、`uploadId` 和 900 秒上限的分片预签名 URL。
- `ListParts` 恢复远端已完成分片，连续分片合并后下载内容、大小和 SHA-256 均一致。
- 私有 Bucket 匿名 GET 返回 403；另一用户读取会话返回 404。
- Multipart ETag 与完整文件 MD5 不相等，ETag 只作为对象存储分片完成凭证。
- Worker/ImportJob 直接消费 `GetObject` 响应异步流，增量计算 SHA-256 后核对 `FileObject.sha256`，小型 JSON 导入实际进入 `SUCCEEDED`。
- 对象存储断开、错误凭据会返回不可用；过期 UploadSession 会标记 `EXPIRED` 并调用 `AbortMultipartUpload`，远端 uploadId 随后不可继续列片。
- 新对象键为用户 ID 加随机 UUID；服务端所有会话、FileObject 查询均带 ownerId。
- 跨用户完成相同内容时，服务端在完整 SHA-256 校验后才复用已验证的物理键：每位用户仍有独立 `FileObject`，完成响应不返回物理对象键、bucket 或他人 ownerId。filesystem E2E 验证共享字节仍可由第二位用户导入。
- 一次性本地 HTTP 延迟代理将首个 MinIO UploadPart 延迟 250 ms，`S3_TIMEOUT_MS=50` 时 API 返回 500 且没有持久化完成片；相同 session 的第二次分片成功并完成 SHA-256 校验。该测试证明本地可恢复的超时边界，不代表生产 S3/R2。

## 当前实现边界

- `STORAGE_DRIVER=filesystem` 仍是默认开发模式；显式设置 `STORAGE_DRIVER=minio` 或 `s3` 才启用适配器。
- 当前 Worker 为流式读取加内存缓存后解析 JSON，尚未做真正的流式 JSON 解析。
- 跨用户物理复用已在本地 filesystem/MinIO 链路验证；每位用户仍保留独立 FileObject。若未来加入文件删除，必须先增加引用计数或事务化的孤儿回收，不能直接删除共享物理键。
- MinIO 是本地演示和集成测试环境，不代表生产对象存储的可用性、持久性、跨实例限流或故障恢复。
- 本地 MinIO 已通过延迟代理验证一次超时后同会话重试；生产 S3/R2 的网络、代理和凭据故障演练仍待后续环境。
