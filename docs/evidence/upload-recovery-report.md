# 上传恢复自动化证据

生成日期：2026-08-29

## 可重复命令

```powershell
npm run test:browser
npm run benchmark:upload
```

`test:browser` 会重新构建浏览器测试包和 NestJS，再启动隔离测试 API、Vite preview 和 Playwright。测试数据只写入 `server/.env.test` 指向的 `question_bank_test`，全局 teardown 会清理测试用户、题目、上传文件和数据库记录。

## 完整浏览器进程恢复

`e2e/knowledge-route.spec.js` 使用 Chromium `launchPersistentContext` 和临时固定 `userDataDir` 上传 `40 MiB + 101 bytes` JSON 文件：

1. CDP 将上传吞吐限制为 4 MiB/s，页面通过 `MutationObserver` 在可见进度文本首次等于 `37%` 时点击暂停。
2. 测试读取真实 IndexedDB 记录，并通过 UploadSession API 确认本地与服务端的已完成分片列表一致。
3. 测试关闭整个 Chromium persistent context，随后用同一个 `userDataDir` 启动新的 Chromium 进程。
4. 恢复后确认 `sessionId` 不变；网络拦截断言已完成片没有重传、待补片没有重复请求。
5. 最终 ImportJob 到达 `SUCCEEDED`，再从 Questions API 确认题目已写入测试数据库。

`37%` 指页面在途字节进度的可见值，不表示 37% 的分片都已被服务端确认为完整分片。恢复证据以 IndexedDB 和服务端已完成 part 列表为准。

## Electron 进程恢复

同一套 Playwright 文件还会真实启动 Electron：主进程按 256 KiB 发送 IPC 分片并回报字节进度，测试在已有完成片后关闭整个 Electron 进程，再复用相同 `userDataDir` 启动。恢复前后 `sessionId` 和已完成片一致，最终只补传缺片并完成导入。

## 本次结果

- Playwright：6/6。
- 前端 Node 单测：81/81。
- 后端单测：12/12；PostgreSQL E2E：62/62。
- 本地 Redis 6380 + 独立 BullMQ Worker：5/5，验证后 Redis 已关闭。
- Web、Electron renderer、NestJS 和 `dist/src/worker.js` 构建通过。
- Prisma validate 通过。
- `question_bank_test` 只读核对为 18 条迁移已完成、0 条失败；本包未连接或迁移正式数据库。

## 证据边界

- 浏览器和 Electron 验证的是本机进程重启，不是操作系统重启或断电恢复。
- 上传后端仍是本地文件系统，不是 MinIO/S3/R2 Multipart；不能据此宣称生产对象存储可靠性。
- 性能数字见 `upload-performance-report.md/json`，只代表固定机器、本机环回 HTTP 和固定 60 ms 单片延迟。
- 自动化证明分片集合与恢复行为；Promise 并发池、Worker 职责、客户端 Hash 信任边界和秒传泄露边界仍需项目作者本人完成面试讲解验收。
