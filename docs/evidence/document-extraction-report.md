# 本地文档提取证据（2026-08-29）

## 已验证的 PDF 路径

- `DocumentExtractionService` 对 `application/pdf` 使用 `pdf-parse` 读取真实文字层，单元测试由 `pdfkit` 生成 PDF 后提取固定文本通过。
- HTTP E2E 上传真实 PDF：普通 `v1` 管线返回 `400`，`review-v1` 依次经过 `PARSING`、`VALIDATING`、`DEDUPING`，生成 `DRAFT`，任务停在 `WAITING_REVIEW`。
- 成功任务在 `ImportJob.extractionMetrics` 记录 provider、language、字符数、按字符数估算的文本 token、耗时和 `cost: 0`。估算值不是模型计费 token。
- 无文字层 PDF 真实 E2E 进入 `FAILED`，并记录 `PDF has no extractable text layer; scanned PDFs require a separate OCR workflow`。`pdf-parse` 的空页码标记会被过滤，避免被当作正文。

## 图片 OCR 的边界

- PNG/JPEG/WebP 已接入本地开源 `tesseract.js`，只允许 `OCR_LANGUAGE=eng`；`@tesseract.js-data/eng` 作为生产依赖预置，worker 每次识别结束都会终止。
- 真实英文 PNG 单测和 HTTP E2E 均通过：识别结果只会生成 `DRAFT`，并保存 `tesseract.js`、`eng`、字符数、耗时和 `cost: 0`。
- 不需要付费 API 或账号。当前仅预置英文；增加其他语言必须先加入、审查并测试相应本地语言包。扫描 PDF OCR 没有实现，当前会明确失败，不会伪造文本。
