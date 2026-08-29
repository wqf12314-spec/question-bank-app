# ADR 0005：Expand-contract 与本地发布回滚

- 状态：已接受
- 日期：2026-08-29

数据库迁移只在 expand 阶段新增可空列、索引和兼容默认值，旧应用不会因为字段缺失而无法读取；删除和改名必须放到独立 contract 版本，确认所有实例已切换后执行。`20260829190000` 与 `20260829200000` 均为可向后兼容的新增列迁移，正式数据库未执行。

本地兼容性证据：`npm run test:expand-contract` 仅连接 `server/.env.test` 的 `TEST_DATABASE_URL`，模拟未写入新列的旧客户端，并由新 Prisma 结构读取同一行。真实输出为 `version=1`、`status=DRAFT`、`importJobId=null`。该验证覆盖 expand 阶段的双版本写入/读取兼容性，不代表正式库已经迁移，也不替代 staging/生产部署回滚演练。

`node scripts/deployment-rollback-drill.mjs` 使用两个真实发布标识和 current pointer 模拟双槽部署：稳定版正在服务，候选版激活，smoke 明确失败，脚本恢复稳定指针并断言当前版本。该演练验证应用版本切换流程，不代表 staging、生产流量或数据库回滚已经验证。
