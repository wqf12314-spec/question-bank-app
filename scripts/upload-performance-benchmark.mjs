import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { cpus, platform, release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const nobleRoot = join(rootDir, "node_modules", "@noble", "hashes");
const evidenceDir = join(rootDir, "docs", "evidence");
const jsonPath = join(evidenceDir, "upload-performance-report.json");
const markdownPath = join(evidenceDir, "upload-performance-report.md");
const mib = 1024 * 1024;
const partSize = 8 * mib;
const totalBytes = 96 * mib;
const partCount = totalBytes / partSize;
const serverDelayMs = 60;
const runStates = new Map();

function getRunState(runId) {
  if (!runStates.has(runId)) {
    runStates.set(runId, {
      active: 0,
      peakActive: 0,
      requests: 0,
      bytes: 0,
      invalidPartSizes: 0,
      failedOnce: new Set(),
    });
  }
  return runStates.get(runId);
}

async function readRequestBody(request) {
  let bytes = 0;
  for await (const chunk of request) bytes += chunk.length;
  return bytes;
}

function send(response, status, body, contentType = "application/json") {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (request.method === "OPTIONS") {
    send(response, 204, "");
    return;
  }
  if (request.method === "POST" && url.pathname === "/upload") {
    const runId = url.searchParams.get("run") || "unknown";
    const partNumber = Number(url.searchParams.get("part"));
    const state = getRunState(runId);
    state.active += 1;
    state.peakActive = Math.max(state.peakActive, state.active);
    state.requests += 1;
    try {
      const receivedBytes = await readRequestBody(request);
      state.bytes += receivedBytes;
      if (receivedBytes !== partSize) state.invalidPartSizes += 1;
      await new Promise((resolve) => setTimeout(resolve, serverDelayMs));
      const failOnce = url.searchParams.get("failOnce") === "1";
      if (failOnce && partNumber === 4 && !state.failedOnce.has(partNumber)) {
        state.failedOnce.add(partNumber);
        send(response, 503, JSON.stringify({ retryable: true }));
        return;
      }
      send(response, 201, JSON.stringify({ partNumber, receivedBytes }));
    } finally {
      state.active -= 1;
    }
    return;
  }
  if (url.pathname.startsWith("/vendor/")) {
    const relativePath = decodeURIComponent(
      url.pathname.slice("/vendor/".length),
    );
    if (
      !relativePath ||
      relativePath.includes("..") ||
      relativePath.includes("\\")
    ) {
      send(response, 400, "invalid module path", "text/plain");
      return;
    }
    try {
      const source = await readFile(join(nobleRoot, relativePath), "utf8");
      send(response, 200, source, "text/javascript");
    } catch {
      send(response, 404, "module not found", "text/plain");
    }
    return;
  }
  if (url.pathname === "/hash-worker.js") {
    send(
      response,
      200,
      `import { sha256 } from "/vendor/sha2.js";
self.onmessage = async ({ data }) => {
  const { file, chunkSize } = data;
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer();
    hash.update(new Uint8Array(chunk));
  }
  self.postMessage({ type: "done", digest: Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, "0")).join("") });
};`,
      "text/javascript",
    );
    return;
  }
  if (url.pathname === "/pipeline-worker.js") {
    send(
      response,
      200,
      `import { sha256 } from "/vendor/sha2.js";
self.onmessage = async ({ data }) => {
  const { file, chunkSize } = data;
  const hash = sha256.create();
  let index = 0;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer();
    hash.update(new Uint8Array(chunk));
    self.postMessage({ type: "chunk", index });
    index += 1;
  }
  self.postMessage({ type: "done", digest: Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, "0")).join("") });
};`,
      "text/javascript",
    );
    return;
  }
  send(
    response,
    200,
    "<!doctype html><title>Upload benchmark</title>",
    "text/html",
  );
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-precise-memory-info"],
});

try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(
    ({ benchmarkOrigin, benchmarkPartSize, benchmarkTotalBytes }) => {
      const seed = new Uint8Array(benchmarkPartSize);
      for (let index = 0; index < seed.length; index += 4096) {
        seed[index] = (index / 4096) % 251;
      }
      const file = new File(
        Array.from(
          { length: benchmarkTotalBytes / benchmarkPartSize },
          () => seed,
        ),
        "upload-performance.bin",
        { type: "application/octet-stream" },
      );

      const heapBytes = () => performance.memory?.usedJSHeapSize ?? null;
      const toHex = (digest) =>
        Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
          "",
        );
      const delay = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));

      async function measure(action) {
        const longTasks = [];
        let observer;
        try {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longTasks.push({
                durationMs: entry.duration,
                startTimeMs: entry.startTime,
              });
            }
          });
          observer.observe({ type: "longtask", buffered: false });
        } catch {
          observer = null;
        }
        const heapStartBytes = heapBytes();
        let heapPeakBytes = heapStartBytes;
        const memoryTimer = setInterval(() => {
          const current = heapBytes();
          if (current !== null)
            heapPeakBytes = Math.max(heapPeakBytes ?? current, current);
        }, 5);
        const start = performance.now();
        const value = await action();
        const durationMs = performance.now() - start;
        await delay(50);
        clearInterval(memoryTimer);
        observer?.disconnect();
        return {
          value,
          durationMs,
          heapStartBytes,
          heapPeakBytes,
          heapDeltaBytes:
            heapStartBytes === null || heapPeakBytes === null
              ? null
              : heapPeakBytes - heapStartBytes,
          longTaskCount: longTasks.length,
          longTaskTotalMs: longTasks.reduce(
            (total, entry) => total + entry.durationMs,
            0,
          ),
          longestTaskMs: Math.max(
            0,
            ...longTasks.map((entry) => entry.durationMs),
          ),
        };
      }

      function xhrUpload(part, runId, partNumber, failOnce) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const query = new URLSearchParams({
            run: runId,
            part: String(partNumber),
            failOnce: failOnce ? "1" : "0",
          });
          xhr.open("POST", `${benchmarkOrigin}/upload?${query}`);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else
              reject(
                Object.assign(new Error(`HTTP ${xhr.status}`), {
                  status: xhr.status,
                }),
              );
          };
          xhr.onerror = () =>
            reject(Object.assign(new Error("network error"), { status: 0 }));
          xhr.send(part);
        });
      }

      async function runPool(tasks, limit) {
        let nextIndex = 0;
        async function worker() {
          while (nextIndex < tasks.length) {
            const index = nextIndex;
            nextIndex += 1;
            await tasks[index]();
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(limit, tasks.length) }, worker),
        );
      }

      function createUploadStats() {
        return { attempts: 0, attemptFailures: 0, finalFailures: 0 };
      }

      async function uploadOne(
        part,
        runId,
        partNumber,
        stats,
        failOnce = false,
      ) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          stats.attempts += 1;
          try {
            await xhrUpload(part, runId, partNumber, failOnce);
            return;
          } catch (error) {
            stats.attemptFailures += 1;
            if (attempt === 2 || ![0, 503].includes(error.status)) {
              stats.finalFailures += 1;
              return;
            }
            await delay(20 * 2 ** attempt);
          }
        }
      }

      async function uploadRun(concurrency, runId, failOnce = false) {
        const parts = Array.from(
          { length: Math.ceil(file.size / benchmarkPartSize) },
          (_, index) =>
            file.slice(
              index * benchmarkPartSize,
              Math.min((index + 1) * benchmarkPartSize, file.size),
            ),
        );
        const stats = createUploadStats();
        const measured = await measure(() =>
          runPool(
            parts.map(
              (part, index) => () =>
                uploadOne(part, runId, index + 1, stats, failOnce),
            ),
            concurrency,
          ),
        );
        return { ...measured, ...stats };
      }

      function hashInWorker(workerPath = "/hash-worker.js") {
        return new Promise((resolve, reject) => {
          const worker = new Worker(`${benchmarkOrigin}${workerPath}`, {
            type: "module",
          });
          worker.onmessage = ({ data }) => {
            if (data.type !== "done") return;
            worker.terminate();
            resolve(data.digest);
          };
          worker.onerror = (error) => {
            worker.terminate();
            reject(error);
          };
          worker.postMessage({ file, chunkSize: benchmarkPartSize });
        });
      }

      async function hashOnMainThread() {
        const { sha256 } = await import(`${benchmarkOrigin}/vendor/sha2.js`);
        const hash = sha256.create();
        for (let offset = 0; offset < file.size; offset += benchmarkPartSize) {
          const chunk = await file
            .slice(offset, Math.min(offset + benchmarkPartSize, file.size))
            .arrayBuffer();
          hash.update(new Uint8Array(chunk));
        }
        return toHex(hash.digest());
      }

      async function compareHashLocations() {
        const mainThread = await measure(hashOnMainThread);
        const worker = await measure(() => hashInWorker());
        return {
          mainThread,
          worker,
          digestsMatch: mainThread.value === worker.value,
        };
      }

      function pipelineHashAndUpload(runId, concurrency) {
        return new Promise((resolve, reject) => {
          const worker = new Worker(`${benchmarkOrigin}/pipeline-worker.js`, {
            type: "module",
          });
          const stats = createUploadStats();
          const pending = [];
          const queue = [];
          let active = 0;
          let workerDone = false;
          let digest = "";

          const finishIfReady = async () => {
            if (!workerDone || queue.length > 0 || active > 0) return;
            await Promise.all(pending);
            worker.terminate();
            resolve({ digest, ...stats });
          };
          const pump = () => {
            while (active < concurrency && queue.length > 0) {
              const { index, resolvePart, rejectPart } = queue.shift();
              active += 1;
              const part = file.slice(
                index * benchmarkPartSize,
                Math.min((index + 1) * benchmarkPartSize, file.size),
              );
              uploadOne(part, runId, index + 1, stats)
                .then(resolvePart, rejectPart)
                .finally(() => {
                  active -= 1;
                  pump();
                  void finishIfReady();
                });
            }
          };
          worker.onmessage = ({ data }) => {
            if (data.type === "chunk") {
              const partPromise = new Promise((resolvePart, rejectPart) => {
                queue.push({ index: data.index, resolvePart, rejectPart });
                pump();
              });
              pending.push(partPromise);
              return;
            }
            if (data.type === "done") {
              digest = data.digest;
              workerDone = true;
              void finishIfReady();
            }
          };
          worker.onerror = (error) => {
            worker.terminate();
            reject(error);
          };
          worker.postMessage({ file, chunkSize: benchmarkPartSize });
        });
      }

      async function compareHashStrategies() {
        const preHash = await measure(async () => {
          const digest = await hashInWorker();
          const upload = await uploadRun(4, "strategy-prehash");
          return { digest, upload };
        });
        const pipelined = await measure(() =>
          pipelineHashAndUpload("strategy-pipeline", 4),
        );
        return {
          preHash,
          pipelined,
          digestsMatch: preHash.value.digest === pipelined.value.digest,
        };
      }

      window.__uploadBenchmark = {
        compareHashLocations,
        compareHashStrategies,
        uploadRun,
      };
    },
    {
      benchmarkOrigin: origin,
      benchmarkPartSize: partSize,
      benchmarkTotalBytes: totalBytes,
    },
  );

  const concurrencyRuns = [];
  for (const concurrency of [1, 3, 6, 10]) {
    const runId = `concurrency-${concurrency}`;
    const browserResult = await page.evaluate(
      ({ selectedConcurrency, selectedRunId }) =>
        window.__uploadBenchmark.uploadRun(selectedConcurrency, selectedRunId),
      { selectedConcurrency: concurrency, selectedRunId: runId },
    );
    const serverResult = getRunState(runId);
    concurrencyRuns.push({
      concurrency,
      ...browserResult,
      serverPeakConcurrency: serverResult.peakActive,
      serverRequests: serverResult.requests,
      invalidPartSizes: serverResult.invalidPartSizes,
      throughputMiBPerSecond:
        totalBytes / mib / (browserResult.durationMs / 1000),
      attemptFailureRate:
        browserResult.attempts === 0
          ? 0
          : browserResult.attemptFailures / browserResult.attempts,
      finalFailureRate: browserResult.finalFailures / partCount,
    });
  }

  const recoveryRun = await page.evaluate(() =>
    window.__uploadBenchmark.uploadRun(6, "failure-recovery", true),
  );
  const recoveryServer = getRunState("failure-recovery");
  const hashLocations = await page.evaluate(() =>
    window.__uploadBenchmark.compareHashLocations(),
  );
  const hashStrategies = await page.evaluate(() =>
    window.__uploadBenchmark.compareHashStrategies(),
  );

  const invalidRun = concurrencyRuns.find(
    (run) => run.finalFailures > 0 || run.invalidPartSizes > 0,
  );
  if (invalidRun)
    throw new Error(
      `Concurrency ${invalidRun.concurrency} did not finish cleanly`,
    );
  if (recoveryRun.attemptFailures !== 1 || recoveryRun.finalFailures !== 0) {
    throw new Error("The injected 503 was not retried exactly once");
  }
  if (!hashLocations.digestsMatch || !hashStrategies.digestsMatch) {
    throw new Error("Hash digests differ between compared strategies");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model || "unknown",
      cpuLogicalCount: cpus().length,
      node: process.version,
      chromium: browser.version(),
      transport: `localhost HTTP with ${serverDelayMs}ms server delay per part`,
    },
    fixture: {
      totalBytes,
      totalMiB: totalBytes / mib,
      partSize,
      partSizeMiB: partSize / mib,
      partCount,
    },
    concurrencyRuns,
    recoveryRun: {
      ...recoveryRun,
      serverPeakConcurrency: recoveryServer.peakActive,
      serverRequests: recoveryServer.requests,
      injectedFailure: "part 4 first attempt returned HTTP 503",
    },
    hashLocations,
    hashStrategies,
    limitations: [
      "Results describe this machine and a localhost transport, not production bandwidth or user traffic.",
      "performance.memory is Chromium-specific and represents observed JavaScript heap, not total process RSS.",
      "Long Task entries use the browser PerformanceObserver threshold of 50ms.",
    ],
  };

  const mb = (bytes) => (bytes === null ? "n/a" : (bytes / mib).toFixed(1));
  const number = (value) => Number(value).toFixed(1);
  const percent = (value) => `${(value * 100).toFixed(1)}%`;
  const fastest = [...concurrencyRuns].sort(
    (left, right) => left.durationMs - right.durationMs,
  )[0];
  const markdown = `# 上传恢复与性能基线

生成时间：${report.generatedAt}

## 固定条件

- 机器：${report.environment.cpu}，${report.environment.cpuLogicalCount} 逻辑核心，${report.environment.os}
- 运行时：Node ${report.environment.node}，Chromium ${report.environment.chromium}
- 文件：${report.fixture.totalMiB} MiB，${report.fixture.partCount} 片，每片 ${report.fixture.partSizeMiB} MiB
- 网络：本机环回 HTTP，每片服务端固定延迟 ${serverDelayMs} ms

## 并发基线

| 并发 | 耗时 ms | 吞吐 MiB/s | 峰值请求 | 尝试失败率 | 最终失败率 | JS 堆峰值增量 MiB | Long Task 数 | Long Task 总时长 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${concurrencyRuns
  .map(
    (run) =>
      `| ${run.concurrency} | ${number(run.durationMs)} | ${number(run.throughputMiBPerSecond)} | ${run.serverPeakConcurrency} | ${percent(run.attemptFailureRate)} | ${percent(run.finalFailureRate)} | ${mb(run.heapDeltaBytes)} | ${run.longTaskCount} | ${number(run.longTaskTotalMs)} |`,
  )
  .join("\n")}

本机固定条件下耗时最低的是并发 ${fastest.concurrency}（${number(fastest.durationMs)} ms）。这不是生产环境最优值；公网带宽、对象存储限流、代理和用户设备都会改变结果。

故障恢复场景在并发 6 时让第 4 片第一次返回 503：共 ${recoveryRun.attempts} 次请求尝试，尝试级失败 ${recoveryRun.attemptFailures} 次，最终失败 ${recoveryRun.finalFailures} 片，证明有限重试可以恢复瞬时错误。

## Hash 主线程对比

| 位置 | 耗时 ms | JS 堆峰值增量 MiB | Long Task 数 | Long Task 总时长 ms | 最长任务 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 主线程增量 SHA-256 | ${number(hashLocations.mainThread.durationMs)} | ${mb(hashLocations.mainThread.heapDeltaBytes)} | ${hashLocations.mainThread.longTaskCount} | ${number(hashLocations.mainThread.longTaskTotalMs)} | ${number(hashLocations.mainThread.longestTaskMs)} |
| Web Worker 增量 SHA-256 | ${number(hashLocations.worker.durationMs)} | ${mb(hashLocations.worker.heapDeltaBytes)} | ${hashLocations.worker.longTaskCount} | ${number(hashLocations.worker.longTaskTotalMs)} | ${number(hashLocations.worker.longestTaskMs)} |

两种位置的摘要一致：${hashLocations.digestsMatch}。Web Worker 的目的，是把 CPU 密集 Hash 移出页面主线程；它不负责限制网络并发。

## 先完整 Hash 与边 Hash 边上传

| 策略 | 总耗时 ms | JS 堆峰值增量 MiB | Long Task 数 |
| --- | ---: | ---: | ---: |
| 先完整 Worker Hash，再上传 | ${number(hashStrategies.preHash.durationMs)} | ${mb(hashStrategies.preHash.heapDeltaBytes)} | ${hashStrategies.preHash.longTaskCount} |
| Worker 边 Hash，主线程按块开始上传 | ${number(hashStrategies.pipelined.durationMs)} | ${mb(hashStrategies.pipelined.heapDeltaBytes)} | ${hashStrategies.pipelined.longTaskCount} |

两种策略的全文件 SHA-256 一致：${hashStrategies.digestsMatch}。当前产品选择“先完整 Hash”：优点是发出分片前就能查询同用户秒传，恢复键也有完整指纹；代价是首个上传请求更晚。边 Hash 边上传可以重叠 CPU 与网络，但无法在上传前完成秒传判断，状态和失败清理也更复杂。

## 8 MiB 与并发池权衡

- 96 MiB 文件被切成 12 片。更小的分片让恢复粒度更细，但会增加请求、数据库元数据和签名开销。
- 更大的分片减少请求数，但失败重传成本、单片内存占用和进度跳跃都会增大。
- 不能对所有分片直接执行 \`Promise.all\`：它会同时创建全部请求；有界并发池把活跃请求限制在配置值，一个完成后才调度下一个。

## 证据边界

${report.limitations.map((item) => `- ${item}`).join("\n")}
`;

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  console.log(`Upload benchmark passed: ${markdownPath}`);
  console.log(
    JSON.stringify(
      {
        fastestConcurrency: fastest.concurrency,
        recoveryFinalFailures: recoveryRun.finalFailures,
        mainThreadLongTasks: hashLocations.mainThread.longTaskCount,
        workerLongTasks: hashLocations.worker.longTaskCount,
        hashDigestsMatch: hashLocations.digestsMatch,
        strategyDigestsMatch: hashStrategies.digestsMatch,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
