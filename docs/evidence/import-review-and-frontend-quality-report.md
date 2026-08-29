# 第 3/5 包验收证据（2026-08-29）

## 导入审核与确定性提取

- `ImportJob.pipelineVersion` 以 `review-` 开头时启用审核模式。
- JSON 使用 Ajv 严格 schema 校验：禁止未知字段，校验 schemaVersion、题目标题、难度、标签和元数据范围。
- 审核模式的合法题目写入 `DRAFT`，任务进入 `WAITING_REVIEW`；管理员 `POST /import-jobs/:id/publish` 进入 `PUBLISHING`，逐题改为 `PUBLISHED` 后任务为 `SUCCEEDED`。
- 发布事务为每道题写入 `QuestionRevision` 和 `AuditLog`；编辑者调用发布接口返回 403。
- `source`、`promptVersion`、`confidence`、`reviewerId` 已持久化。PDF 文字层另使用本地 `pdf-parse`，成功/失败提取指标持久化在 `ImportJob.extractionMetrics`；字符数估算 token 不代表模型计费 token，`cost: 0` 只表示未调用付费服务。
- `Question.reviewSuggestions` 只在审核预览返回。它由本地关键词和空白规范规则生成分类、难度和答案格式建议；用户点击“采纳建议并保存”后才经既有 Questions PATCH 写入，并留下 `REVIEW_SUGGESTION_ACCEPTED` Revision 原因。
- 2026-08-29 独立 PostgreSQL E2E：审核发布正常场景、编辑者越权、审核预览建议/人工采纳/整批回滚均通过；NestJS 构建和 Prisma validate 通过。

仍阻塞：扫描 PDF OCR、其他 OCR 语言、语义 embedding 去重和真实模型费用统计未完成；本地确定性建议不应称作 AI。PDF 文字层和预置英文 PNG OCR 的可验证范围见 `docs/evidence/document-extraction-report.md`。

## 前端安全、性能与可访问性

- 题目答案支持 Markdown 编辑/预览；展示路径统一经 `marked` + `DOMPurify`，脚本、事件属性、iframe 等危险内容会被移除。
- Node 测试覆盖恶意 `<script>`/`onerror` 输入，确认输出不含攻击载荷。
- 编辑/预览使用键盘可聚焦按钮、`role=tab`、`aria-selected`，全局已有 `:focus-visible` 焦点样式。
- 默认主题为中性职业配色，支持持久化切换到专注主题；主题只保存名称，不保存密钥或外部配置。
- 当前题目列表服务端分页，约 225 条数据未观察到真实卡顿阈值，因此不提前引入虚拟列表；需在真实低端设备上补充性能采样后再决定。

验证：前端 `npm test` 75/75、Web 构建通过、NestJS 构建通过、前端 lint 通过。完整 WCAG 对比度审计和浏览器辅助技术验收仍待补充。
