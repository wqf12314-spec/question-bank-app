# 上传恢复与性能基线

生成时间：2026-08-29T05:35:40.971Z

## 固定条件

- 机器：AMD Ryzen 7 5700X 8-Core Processor             ，16 逻辑核心，win32 10.0.26200
- 运行时：Node v24.18.0，Chromium 151.0.7922.34
- 文件：96 MiB，12 片，每片 8 MiB
- 网络：本机环回 HTTP，每片服务端固定延迟 60 ms

## 并发基线

| 并发 | 耗时 ms | 吞吐 MiB/s | 峰值请求 | 尝试失败率 | 最终失败率 | JS 堆峰值增量 MiB | Long Task 数 | Long Task 总时长 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1003.6 | 95.7 | 1 | 0.0% | 0.0% | 0.1 | 0 | 0.0 |
| 3 | 359.3 | 267.2 | 3 | 0.0% | 0.0% | 0.0 | 0 | 0.0 |
| 6 | 222.9 | 430.7 | 6 | 0.0% | 0.0% | 0.0 | 0 | 0.0 |
| 10 | 233.4 | 411.3 | 6 | 0.0% | 0.0% | 0.0 | 0 | 0.0 |

本机固定条件下耗时最低的是并发 6（222.9 ms）。这不是生产环境最优值；公网带宽、对象存储限流、代理和用户设备都会改变结果。

故障恢复场景在并发 6 时让第 4 片第一次返回 503：共 13 次请求尝试，尝试级失败 1 次，最终失败 0 片，证明有限重试可以恢复瞬时错误。

## Hash 主线程对比

| 位置 | 耗时 ms | JS 堆峰值增量 MiB | Long Task 数 | Long Task 总时长 ms | 最长任务 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 主线程增量 SHA-256 | 665.4 | 55.6 | 3 | 169.0 | 68.0 |
| Web Worker 增量 SHA-256 | 651.4 | 0.0 | 0 | 0.0 | 0.0 |

两种位置的摘要一致：true。Web Worker 的目的，是把 CPU 密集 Hash 移出页面主线程；它不负责限制网络并发。

## 先完整 Hash 与边 Hash 边上传

| 策略 | 总耗时 ms | JS 堆峰值增量 MiB | Long Task 数 |
| --- | ---: | ---: | ---: |
| 先完整 Worker Hash，再上传 | 1062.4 | 0.0 | 0 |
| Worker 边 Hash，主线程按块开始上传 | 788.6 | 0.0 | 0 |

两种策略的全文件 SHA-256 一致：true。当前产品选择“先完整 Hash”：优点是发出分片前就能查询同用户秒传，恢复键也有完整指纹；代价是首个上传请求更晚。边 Hash 边上传可以重叠 CPU 与网络，但无法在上传前完成秒传判断，状态和失败清理也更复杂。

## 8 MiB 与并发池权衡

- 96 MiB 文件被切成 12 片。更小的分片让恢复粒度更细，但会增加请求、数据库元数据和签名开销。
- 更大的分片减少请求数，但失败重传成本、单片内存占用和进度跳跃都会增大。
- 不能对所有分片直接执行 `Promise.all`：它会同时创建全部请求；有界并发池把活跃请求限制在配置值，一个完成后才调度下一个。

## 证据边界

- Results describe this machine and a localhost transport, not production bandwidth or user traffic.
- performance.memory is Chromium-specific and represents observed JavaScript heap, not total process RSS.
- Long Task entries use the browser PerformanceObserver threshold of 50ms.
