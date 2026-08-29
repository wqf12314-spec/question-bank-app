# 前端面试题库

一个使用 Vue 3 构建的本地优先面试刷题工具，支持题库管理、筛选推荐、作答复习和学习统计。

在线体验：<https://wqf12314-spec.github.io/question-bank-app/>

## 功能

- 题目新增、编辑、删除和关键词搜索
- 分类、标签、难度与多标签筛选
- JSON 批量导入、示例题库下载和题库导出
- 登录、Refresh Token 会话、RBAC 和按用户隔离的练习记录
- 收藏、个人备注、乐观锁协作审核和历史回滚
- 本地分片上传、SHA-256 校验、断点恢复和异步 ImportJob 进度
- 首页按分类与标签随机推荐
- 作答模式与查看模式
- 文本输入与代码输入样式切换
- 自评、改评、重新作答和历史记录
- 分类、标签、掌握情况与刷题进度统计
- localStorage 本地持久化

## 技术栈

- Vue 3 Composition API
- Vue Router 4
- Pinia 2
- Vite 5
- NestJS、Prisma、PostgreSQL、Redis、BullMQ、Pino
- Electron（与 Web 共用 `src/`）
- Node.js Test Runner、Jest、Playwright

## 本地运行

需要 Node.js 18 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开终端显示的本地地址。

## 测试与构建

```bash
npm test
npm run build
npm run desktop:build
npm run test:browser
npm run benchmark:upload
```

后端 Questions API 使用独立的 PostgreSQL 测试数据库，避免测试数据写入正式题库：

```bash
cd server
npm run test:e2e -- --runInBand
npm run test:worker
npm run build
npx prisma validate
```

E2E 测试通过 `server/.env.test` 中的 `TEST_DATABASE_URL` 连接独立测试库，覆盖正常导入、批内重复、库内重复、10 个并发重复请求、并发单题重复、单题新增/修改、服务端分页与组合筛选、乐观锁并发冲突、QuestionRevision 前后快照、状态迁移/发布/回滚、用户角色修改与 AuditLog、非法输入校验、上传分片合并/Hash/配额校验、跨用户上传会话与同 Hash 隔离、上传 MIME/ZIP 路径/数量/体积安全、本地 ImportJob 成功/失败/取消/重试/幂等/阶段指标/逐项失败报告、SSE 快照、健康检查与进程内指标、readiness 对象目录失败、Helmet/CORS、入口限流和权限隔离，以及成功/错误响应的 `X-Request-Id` 追踪。每个测试结束后会按外键依赖清理 `ImportJob`、`FileObject`、`UploadPart`、`UploadSession`、`RefreshSession`、`User` 和 `Question` 数据（用户/题目级联清理个人数据），并等待本地 ImportJob 队列排空后再关闭 Prisma 连接；最近一次 app E2E 验证为 62 个用例全部通过。E2E 夹具会在每个用例启动时显式监听一次 HTTP Server，保证并发 Supertest 请求不会因各自自动 `listen/close` 而互相重置；测试环境的 `PrismaPg` 连接池显式设置为 20 作为慢 PostgreSQL 的连接余量，生产仍使用 Neon 适配器。

最近一次本地验收为：前端 Node 单测 81/81、后端单测 12/12、后端 HTTP E2E 合计 68/68（app 62/62 + MinIO 6/6）、Worker 集成 5/5，以及 Playwright Chromium/Electron 冒烟 7/7；PDF/PNG 提取专项单测 3/3、HTTP E2E 3/3；Web、Electron renderer、NestJS 和独立 Worker 构建均通过。PracticeRecord 并发重放 10/10 返回成功且数据库只保留 1 条，使用 PostgreSQL `ON CONFLICT DO NOTHING` 和有限退避。当前 V2 清单为 206 项中 179 项完成、27 项未完成（86.9%）。本轮补齐审核导入页面、Ajv 单题 PARTIAL 边界、MinIO Multipart ETag 实验、跨用户内部物理去重、Web/Electron 共用的本地隐私遥测开关、PostgreSQL readiness 本地告警、expand-contract 测试库兼容性验证，以及 PDF/PNG 只进 Draft 的本地提取与确定性建议的人工确认；证据见 `docs/evidence/v2-local-reliability-and-review-report.md`、`docs/evidence/object-storage-report.md`、`docs/evidence/import-review-and-frontend-quality-report.md`、`docs/evidence/document-extraction-report.md` 与 `docs/adr/0005-expand-contract-and-rollback.md`。CI 配置见 `.github/workflows/ci.yml`，已声明 PostgreSQL、Redis 和 MinIO service containers，并执行前后端测试、Worker/Playwright 测试、Prisma 校验及各端构建；Dependabot 和 CodeQL 也已配置，但这些工作流尚无本轮 GitHub Actions 线上成功记录。MinIO 已在本机独立进程验证，生产 S3/R2、外部 Sentry、staging 和生产迁移仍未验证。
CI 质量门禁本地证据见 `docs/evidence/ci-quality-gate-report.md`：根目录和 `server` 的 Prettier 格式检查、ESLint、前端 82/82 与后端单测 12/12 均通过；CI 配置已声明 PostgreSQL、Redis、MinIO service containers，并通过 `npm run ci:validate` 做结构契约检查。GitHub Actions 线上运行 `33260928900` 已成功，包含 service containers、Playwright Electron 冒烟和各端构建；本机没有 Docker，无法复现同构 service container，但线上已取得真实记录。应用默认使用本地文件系统，但已提供显式启用本地 MinIO 的 Multipart/预签名 URL 适配器，证据见 `docs/evidence/object-storage-report.md`。

上传接口默认提供本地文件学习演示：服务端把分片和合并文件保存到 `server/.data/uploads`（可通过 `UPLOAD_DIR` 修改），数据库只保存会话、分片和文件元数据，不保存二进制。显式设置 `STORAGE_DRIVER=minio` 后会使用本地 MinIO Multipart、远端分片恢复和短期预签名 URL；该模式不代表 Render 线上持久化能力，生产 R2/S3 尚未验证。

审核导入使用 `review-*` pipeline：合法 JSON 经过 Ajv 顶层容器校验、单题字段校验后进入 `WAITING_REVIEW`；坏行会进入逐项失败报告而不是丢弃同批合法题。PDF 真实文字层经本地 `pdf-parse` 提取，PNG/JPEG/WebP 经预置英文 `tesseract.js` 语言包识别后都只会生成 Draft，普通 `v1` 管线会被 400 拒绝；无文字层 PDF 明确失败，不会伪造文本。当前只预置并验证 `eng`，增加其他 OCR 语言前必须将对应语言包作为受审查的本地依赖。页面支持审核预览、逐项修正、确定性规则建议的人工采纳、管理员发布和整批回滚，发布事务会将关联草稿转为 `PUBLISHED`，并记录审核人、QuestionRevision 和 AuditLog。规则建议仅基于关键词和空白格式，明确不是 AI；语义去重使用本地 bigram/Jaccard 仅生成候选，绝不自动删除。答案支持 Markdown 编辑/预览，展示前使用 DOMPurify 清洗；默认中性主题可切换专注主题并持久化。

题库管理页的“大文件上传”面板已接入本地上传链路：选择文件后会分别显示 SHA-256、分片上传和服务端校验阶段，支持暂停/继续/取消。暂停会保留已完成分片，继续时按文件名、大小、修改时间和 SHA-256 校验恢复会话；当前进度在浏览器有 IndexedDB 时持久化，没有 IndexedDB 时退回内存适配器。Chromium Playwright 使用固定临时 profile，在可见进度精确到达 37% 时暂停，核对 IndexedDB 与服务端已完成片后关闭整个 Chromium 进程，再复用 profile 启动新进程；测试确认 sessionId 不变、已完成片不重传、待补片不重复，最终 ImportJob 成功。Electron Playwright 也会关闭整个桌面进程并复用同一 userData 目录完成缺片恢复。详细证据见 `docs/evidence/upload-recovery-report.md`，这些结果不代表线上对象存储能力。

`npm run benchmark:upload` 会以固定 96 MiB 文件、12 个 8 MiB 分片、本机环回 HTTP 和每片 60 ms 延迟生成 `docs/evidence/upload-performance-report.md/json`。最近一次并发 1/3/6/10 的耗时分别为 1003.6/359.3/222.9/233.4 ms；配置并发 10 时浏览器同源请求峰值仍为 6。主线程增量 SHA-256 观察到 3 个 Long Task（总 169 ms、最长 68 ms），Worker 方案本次观察为 0 个；两者摘要一致。该数字只是本机基线，不能表述为生产最优并发、“零卡顿”或高并发能力。

跨端练习记录已通过真实进程验证：Playwright 在 Web UI 写入记录后启动 Electron，用同一账号读取服务端记录；关闭整个 Electron 进程并以同一 userData 目录重启后，加密保存的 Refresh Token 能恢复会话并再次读取记录。Linux CI 没有系统密钥环，测试进程仅在 `NODE_ENV=test` 的隔离 profile 中使用由 profile 路径派生的 AES-GCM fallback，生产仍不允许安全存储不可用时明文回退。测试过程中修复了登录后的会话级记录请求被路由导航取消的竞态；页面请求仍默认随导航取消，退出登录仍会取消全部会话请求。

上传完成后会调用 `POST /import-jobs` 创建异步导入任务，并通过 `GET /import-jobs/:id/events` 接收 SSE 快照和状态事件，重连时携带 `Last-Event-ID` 获取未读事件。任务会读取已合并的 JSON 文件并复用 QuestionsService 的数据库查重导入；`review-*` 还可消费已验证的 PDF 文字层和预置英文 PNG OCR，并记录 provider、字符数、近似文本 token、耗时、失败和 `cost: 0`。这里的近似文本 token 不是模型计费 token，当前未接入付费模型。MinIO 模式由 Worker 直接消费对象响应流、增量核对 SHA-256 后再解析；同一用户的 `idempotencyKey` 重复提交返回原任务。失败任务会保存 JSON 逐项报告（题目序号和原因），页面可下载报告并重新处理。本地已使用 `127.0.0.1:6380` 的 Redis、BullMQ 和独立 `dist/src/worker.js` 验证入队、并发限制、瞬时/永久错误重试差异及 Worker 退出后的 stalled 恢复；线上 Redis、对象存储和其他 OCR 语言仍未验证。

Redis 锁边界已记录在 `docs/adr/0004-redis-lock-boundary.md`：12 路并发创建同一 ImportJob 的 E2E 中所有请求返回同一任务，数据库唯一约束完成最终仲裁，因此当前不新增业务层 `SET NX` 锁。BullMQ 的 Redis lock/stalled 只负责队列 job 领取和恢复，不等同于业务互斥锁；若未来接入数据库无法表达的非幂等跨进程资源，必须另行设计 TTL、owner token、续租上限、崩溃释放和 fencing token，并增加故障观测与测试。

当前 V2 本地闭环已补充：上传成功会由 `UploadPanel` 自动创建 `ImportJob`，Web 通过带 `Last-Event-ID` 的 SSE 请求接收进度并在断线后重连；桌面端沿用同一业务客户端，在主进程暂不支持长连接时对事件接口轮询恢复。任务状态包含 `DEDUPING`、`PARTIAL`，并记录解析/校验阶段时间、输入、导入、重复和失败数量，进程重启会重新调度 `QUEUED` 任务并将超过 15 分钟的处理中任务标记为可重试失败。

上传安全校验在 filesystem 和本地 MinIO 模式共用：服务端读取文件头确认 MIME，ZIP 限制路径穿越、文件数量（1000）和解压体积（100 MiB），单文件上限为 500 MiB，每用户默认限制 100 个文件和 2 GiB 已占用/进行中空间；过期会话由定时清理器标记、删除本地分片并终止 MinIO Multipart。相同用户重复提交相同 SHA-256 会复用已验证 `FileObject`；不同用户只有在完成服务端 Hash 校验后才由服务端内部复用同一物理键，仍各自保留所有权记录，完成响应不会返回物理 `objectKey`、`bucket` 或他人 ID。MinIO E2E 还以一次性延迟代理让首个分片在 50 ms 阈值超时，确认服务器不记录该片，重试同一会话后可完成。该恢复证据仅覆盖本地 MinIO，不能外推生产 S3/R2。浏览器分片使用 XHR upload progress；Electron 使用受限 preload/IPC Transport，把分片交给主进程按 256 KiB 流式发送并回传真实字节进度，API 域名、请求头和单片大小均受白名单或上限约束。

题目协作治理已提供 `POST /questions/:id/status` 状态迁移、`GET /questions/:id/revisions` 修订查询和管理员 `POST /questions/:id/rollback/:revisionId` 历史回滚。编辑者可提交 `IN_REVIEW`，只有管理员可发布；状态迁移、更新和回滚同时写入 `QuestionRevision` 与 `AuditLog`，删除写入独立审计记录。管理员还可通过 `PATCH /users/:id/role` 修改角色，Service 事务会写入 `USER_ROLE_CHANGED` 审计，`GET /audit-logs` 可供管理员核验。状态规则在 Service 层校验，不能通过普通 `PATCH` 任意修改 `status`。

题库搜索输入使用 250ms 防抖，Store 在发起新查询前取消旧请求；Questions API 在服务端执行分页、关键词、分类和标签筛选，分页按题目 ID 稳定排序。

API 还提供 `/health/live`（只检查进程）、`/health/ready`（检查 PostgreSQL、Redis，以及当前启用的 filesystem 目录或 MinIO Bucket）及 `/health/metrics`。PostgreSQL readiness 失败会记录一条本地 Pino/内存等价告警并返回 `503 POSTGRES_NOT_READY`，尚未接入外部值班告警平台。请求 middleware 使用 Pino 输出 JSON 结构化日志，包含 requestId、route、status、duration、可用时的 userId/jobId；ImportJob 会持久化创建请求的 requestId，BullMQ payload 和独立 Worker 日志继续携带同一关联 ID。Web/Electron 共用本地错误记录和隐私设置，默认关闭，启用后只记录 route/release/requestId 和已清洗元数据；这不是外部 Sentry。指标端点提供进程内请求量、5xx、p95、导入耗时/失败率、队列深度和 409 冲突采样。并接入 Helmet、安全响应头、严格 CORS 白名单和登录/注册/上传初始化进程内限流。指标仍只是进程内滑动窗口，不代表多实例长期监控。

正式 Neon 数据库迁移状态仅做只读检查：当前仍有 `20260829130000_add_import_pipeline_version`、`20260829140000_add_question_revisions_audit`、`20260829150000_import_metrics_and_file_dedupe`、`20260829160000_add_import_failure_report` 和 `20260829170000_add_import_request_id` 待人工审查后部署；本地测试库已应用全部迁移。本轮曾误执行一次未显式指定测试连接的 `prisma migrate deploy`，输出显示尝试应用 `20260829100000`、`20260829120000` 后，在 `20260829121000` 的重复索引错误处停止；之后未继续修复或 `migrate resolve`。这次触达已记录，后续没有明确生产确认前禁止运行生产迁移命令，需先由维护者核对 Neon 的 `_prisma_migrations` 和实际表结构。

## 题库迁移

在题库管理页可以导出 JSON，也可以批量导入符合以下结构的数据：

```json
{
  "schemaVersion": 1,
  "questions": [
    {
      "title": "Vue 的 ref 是什么？",
      "answer": "ref 用于创建响应式值。",
      "category": "Vue",
      "tags": ["Vue", "响应式"],
      "difficulty": "基础"
    }
  ]
}
```

项目也提供了 [`public/sample-question-bank.json`](public/sample-question-bank.json) 作为示例。

## 数据说明

访客模式下题目和练习记录保存在当前浏览器的 localStorage 中；登录后练习记录会通过 API 保存到服务端。题库本地缓存仍用于离线降级，请定期导出题库备份。

界面中的初音未来背景素材不包含在 MIT License 授权范围内，仅用于个人学习演示；公开转载或二次分发前请确认相关素材授权。

## 项目结构

```text
src/
├── components/  可复用组件
├── router/      页面路由
├── stores/      Pinia 数据状态与持久化
├── utils/       筛选、统计和数据迁移函数
└── views/       首页、题库、刷题和统计页面
```

## Windows Electron 桌面版

桌面版不是另一套项目。Electron 直接加载同一份 `src/` Vue 前端，因此网页端新增知识点或修改业务功能后，重新构建即可同时更新两端。

[下载 Windows 安装包](https://github.com/wqf12314-spec/question-bank-app/releases/download/v1.0.0/Knowledge-Navigator-Setup-1.0.0.exe)

```bash
# 开发模式
npm run desktop:dev

# 构建 Windows 安装包
npm run desktop:dist
```

安装包输出到 `release/`。NSIS 安装时会创建“知识航线”桌面快捷方式。桌面窗口默认使用紧凑悬浮布局并始终置顶，支持拖动、缩放、最小化、最大化和关闭；题库编辑、统计与数据迁移收在下方折叠区。

### 网页数据迁移到桌面

浏览器和 Electron 属于两个独立的安全存储空间，无法可靠地自动读取彼此的 `localStorage`。先在网页版页面底部展开“学习数据备份与迁移”并导出，再在桌面版下方“题库与设置 -> 数据”中导入。备份会包含全部 `localStorage` 键，包括练习记录、离线题库、收藏和后续新增的本地设置。

桌面版还会把这些数据同步到 `%APPDATA%\知识航线\learning-data.json`，应用重启和覆盖升级后会先恢复数据，再创建 Pinia Store。

## License

[MIT](LICENSE)
