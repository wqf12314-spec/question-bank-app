# ADR 0004：Redis 分布式锁边界

- 状态：已接受
- 日期：2026-08-29
- 决策：当前不引入业务层 Redis 分布式锁

## 背景

项目同时支持 Web、Electron、NestJS API 和独立 BullMQ Worker。需要区分两种并发：

1. **同一业务数据被重复写入**：题目标题、练习记录、收藏、备注和 ImportJob。
2. **真正跨进程共享且数据库无法表达的资源**：例如只有一个进程可以占用的外部租约、硬件设备、非幂等第三方任务或跨实例临界文件操作。

第一类是数据一致性问题，不应先用 Redis 锁掩盖数据库模型缺口。第二类目前没有出现在本项目的业务链路中。

## 证据与边界核对

- `Question.normalizedTitle`、`(userId, clientRequestId)`、`(userId, questionId)` 和 `(userId, idempotencyKey)` 都有数据库唯一约束。
- 题目更新使用 `version` 条件更新；并发 PATCH 测试稳定得到一个 200 和一个 `QUESTION_VERSION_CONFLICT` 409。
- `QuestionsService.importMany` 使用数据库 `createMany(..., skipDuplicates)`，12 路并发导入测试最终只保存一条题目。
- `ImportJobsService.create` 使用 `(userId, idempotencyKey)` 唯一约束；12 路并发 `POST /import-jobs` 测试全部返回同一 `jobId`，数据库只保留一条任务。
- `PracticeRecord` 并发重放测试验证同一 `(userId, clientRequestId)` 只新增一条记录。
- BullMQ 的 Redis lock/stalled 机制只负责“一个 Worker 领取一个队列 job”和故障恢复；它不是业务对象的通用互斥锁，业务代码不依赖自建 `SET NX` 锁。
- UploadSession 的分片幂等由 `(sessionId, partNumber)` 唯一约束和服务端所有权校验表达，合并前再次核对分片集合与大小。

可重复验证：

```powershell
cd server
npm run test:e2e -- --runInBand -t "并发创建同一 ImportJob|并发导入相同标题|并发修改同一题目|同一个练习请求并发重放"
```

本次独立测试库运行结果：相关并发场景通过；完整后端 E2E 为 56/56。新增用例以 12 路并发请求创建同一 `ImportJob`，所有响应返回同一 `jobId`，数据库最终只有 1 条任务。测试只使用 `question_bank_test`，不连接正式数据库。

## 决策

当前不新增 Redis 业务锁。数据库唯一约束、事务、幂等键和乐观锁已经把当前共享状态表达在持久化边界内，锁只会增加超时、续租、死锁、故障排查和多实例一致性成本，并不能替代正确的所有权/版本模型。

如果未来新增资源满足“跨进程共享、无法转化为数据库状态、重复执行有外部副作用”，再单独建 ADR 和契约测试，不能因为已有 Redis 就默认加锁。

## 未来若确实需要锁，必须回答

- **过期**：租约必须有 TTL，业务耗时不能无限持有；锁值必须是随机 owner token，释放时只允许 owner 删除。
- **续租**：续租只能由仍持有 owner token 的进程完成，并设置最大租期，避免网络分区下无限续租。
- **进程崩溃**：进程退出后等待 TTL 自动释放；不能把“客户端 finally 执行”当作可靠释放机制。
- **fencing token**：每次成功获取锁都递增 fencing token，下游资源必须拒绝旧 token，防止暂停很久的旧进程在锁过期后继续写入。
- **可观测性**：记录等待、获取、续租、超时、释放和 fencing 拒绝；故障测试必须覆盖 Redis 不可用、网络分区和持锁进程强杀。

## 后果

正面：当前一致性规则简单、可由 PostgreSQL 最终仲裁，重试可安全幂等，普通题库请求不依赖 Redis。

代价：若将来接入非幂等外部资源，需要重新评估并可能引入带 fencing 的租约；BullMQ 自身的队列锁仍由 BullMQ 管理，不能把它误写成项目业务锁。
