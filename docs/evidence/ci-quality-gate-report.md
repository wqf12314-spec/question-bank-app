# CI 质量门禁与 service containers 证据

生成日期：2026-08-29

## 已实现并在本地通过

- 根目录 `npm run format:check`：通过。
- 根目录 `npm run lint`：通过。
- 根目录 `npm test`：81/81，通过；其中用例验证 CI 配置完整性和缺少 MinIO 时的失败路径。
- `server/npm run format:check`：通过。
- `server/npm run lint`：通过。
- `server/npm test -- --runInBand`：12/12，通过。
- `npm run ci:validate`：通过，确认 CI 声明 PostgreSQL、Redis、MinIO，且包含 format、lint、迁移、前后端测试和 Prisma 校验命令。
- `npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high`：前端初次扫描发现 `nanoid`/`postcss` high，已将兼容的 `nanoid` 3.3.18 与 `postcss` 8.5.23 固定到 lockfile；复扫结果为 0 个漏洞。后端扫描仍发现 Prisma 7 链路的 `@prisma/config`/`deepmerge-ts` 共 3 个 high；可用修复会降级 Prisma 到 6.x，未在本包强行改变 Prisma 主版本，保留为依赖升级决策项。

## 本轮最终复核（2026-08-29）

- 独立 PostgreSQL API E2E：`62/62` 通过；测试连接 `server/.env.test` 的专用数据库，清理前等待本地 ImportJob 队列排空，避免关闭 Prisma 连接后后台任务继续写库。
- Redis + BullMQ 独立 Worker：`5/5` 通过；使用本机 `redis-server` 的 `127.0.0.1:6380`，覆盖入队、永久/瞬时错误重试、Worker 退出后的 stalled 恢复和 Redis 故障降级。Redis 进程已在测试后关闭。
- Playwright Chromium/Electron 冒烟：`6/6` 通过；包含登录、刷题、37% 暂停、浏览器/Electron 整进程重启续传和 ImportJob 进度。
- 构建：Web `npm run build`、Electron renderer `npm run desktop:build`、NestJS/Worker `server/npm run build` 均通过。
- 后端依赖复扫：`server/npm audit --audit-level=high` 仍报告 `deepmerge-ts` 经 Prisma 7 链路产生 `3 high`；`npm audit fix --force` 会降级 Prisma 主版本，本包未自动执行。

并发稳定性修复：本地降级队列现在登记所有已调度任务，并提供 `waitForIdle()`；E2E 清理先等待任务完成再删除测试数据。该修复针对线上曾出现的 `ImportJob_fileObjectId_fkey`、`Cannot use a pool after calling end on the pool` 和幂等读取竞态，不能替代多实例生产队列演练。

## CI 配置

`.github/workflows/ci.yml` 使用 PostgreSQL 16、Redis 7 和 MinIO service containers。MinIO 冒烟脚本 `scripts/minio-service-smoke.mjs` 会等待 `/minio/health/ready`，执行 bucket 创建、对象上传、下载、缺失对象 404 验证和清理。

`.github/workflows/codeql.yml` 和 `.github/dependabot.yml` 已存在，覆盖 JavaScript/TypeScript、根目录 npm 和 `server` npm 依赖。

## 边界与阻塞

- 本机未安装 Docker，无法在本地启动 GitHub Actions 同构的 service containers。
- 本机临时 MinIO Windows 下载文件无法作为有效 Win32 进程启动，因此 `test:minio` 尚未取得本地真实成功记录；不会把脚本存在当成 MinIO 集成通过。
- 没有执行 GitHub 远程 workflow、CodeQL Security 分析或 Dependabot PR；当前没有线上成功记录，相关清单继续保留未勾选。
- 当前应用上传实现仍使用本地文件系统，MinIO service container 只是 CI 基础设施与独立探针，不代表产品已接入生产对象存储。
