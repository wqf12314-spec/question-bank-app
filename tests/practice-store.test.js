import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { usePracticeStore } from "../src/stores/practice.js";
import { useAuthStore } from "../src/stores/auth.js";
import {
  classifyUploadError,
  createUploadTransport,
  loadUploadProgress,
  removeUploadProgress,
  runWithConcurrency,
  saveUploadProgress,
  sha256Blob,
  splitFile,
  uploadFile,
  withUploadRetry,
} from "../src/utils/uploadClient.js";

const storage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

test("addRecord creates and returns a normalized record", () => {
  const store = usePracticeStore();
  const id = store.addRecord({
    questionId: 205,
    clientRequestId: "client-request-1",
    userAnswer: "my answer",
    result: "partial",
    mode: "view",
  });

  assert.equal(typeof id, "string");
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].id, id);
  assert.equal(store.records[0].questionId, "205");
  assert.equal(store.records[0].clientRequestId, "client-request-1");
  assert.equal(store.records[0].result, "partial");
  assert.equal(store.records[0].mode, "view");
  assert.ok(store.records[0].practicedAt);
  assert.ok(store.records[0].updatedAt);
});

test("登录用户的 saveRecord 写入云端并保留服务端记录", async () => {
  const originalFetch = globalThis.fetch;
  const authStore = useAuthStore();
  const store = usePracticeStore();
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "POST") {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 7,
            userId: 10,
            questionId: 205,
            clientRequestId: "cloud-request-1",
            userAnswer: "cloud answer",
            result: "correct",
            mode: "write",
            practicedAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  authStore.setUser({ id: 10, email: "cloud@example.test", role: "LEARNER" });
  await nextTick();

  try {
    const saved = await store.saveRecord({
      questionId: 205,
      clientRequestId: "cloud-request-1",
      userAnswer: "cloud answer",
      result: "correct",
      mode: "write",
    });
    assert.equal(saved.id, "7");
    assert.equal(store.records[0].clientRequestId, "cloud-request-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("访客的 saveRecord 仍只保存到本地", async () => {
  const store = usePracticeStore();
  const saved = await store.saveRecord({
    questionId: 205,
    clientRequestId: "guest-request-1",
    userAnswer: "local answer",
    result: "partial",
  });

  assert.equal(saved.clientRequestId, "guest-request-1");
  assert.equal(store.records.length, 1);
  await nextTick();
  assert.match(localStorage.getItem("practice-records"), /guest-request-1/);
});

test("上传工具按固定大小切片并计算 SHA-256", async () => {
  const file = new Blob(["abcdefghij"]);
  const parts = splitFile(file, 4);
  assert.deepEqual(await Promise.all(parts.map((part) => part.text())), [
    "abcd",
    "efgh",
    "ij",
  ]);
  assert.equal(
    await sha256Blob(file),
    "72399361da6a7754fec986dca5b7cbaf1c810a28ded4abaf56b2106d06cb78b0",
  );
});

test("Promise 并发池不会超过指定并发数且保持结果顺序", async () => {
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency(
    Array.from({ length: 8 }, (_, index) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return index;
    }),
    3,
  );
  assert.equal(peak, 3);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("AbortSignal 中止并发池后不会继续调度等待中的任务", async () => {
  const controller = new AbortController();
  let started = 0;
  const tasks = Array.from({ length: 6 }, (_, index) => async () => {
    started += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (controller.signal.aborted) throw controller.signal.reason;
    return index;
  });

  const pending = runWithConcurrency(tasks, 2, { signal: controller.signal });
  setTimeout(() => controller.abort("paused"), 1);
  await assert.rejects(pending, (error) => error === "paused");
  assert.ok(started <= 2);
});

test("上传重试只处理瞬时错误，永久错误立即结束", async () => {
  let attempts = 0;
  const result = await withUploadRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw { status: 503 };
      return "ok";
    },
    { retries: 2, delayMs: 0 },
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.equal(classifyUploadError({ status: 403 }), "permanent");
});

test("上传 Transport 将平台差异隔离在分片适配器中", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body });
    return new Response(
      JSON.stringify({ success: true, data: { partNumber: 1 } }),
      { status: 201 },
    );
  };

  try {
    const transport = createUploadTransport({
      apiBaseUrl: "http://localhost:3002",
    });
    assert.equal(transport.kind, "api");
    const result = await transport.uploadPart(
      "session-1",
      1,
      new Blob(["part"]),
    );
    assert.equal(result.partNumber, 1);
    assert.equal(
      calls[0].url,
      "http://localhost:3002/uploads/session-1/parts/1",
    );
    assert.equal(calls[0].method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Electron IPC Transport 传递认证、二进制和字节进度", async () => {
  const originalWindow = globalThis.window;
  const progress = [];
  let received;
  globalThis.window = {
    desktopAPI: {
      isDesktop: true,
      upload: {
        async part(request, onProgress) {
          received = request;
          onProgress(2);
          onProgress(4);
          return {
            ok: true,
            status: 201,
            body: JSON.stringify({
              success: true,
              data: { partNumber: 1 },
            }),
          };
        },
        async abort() {},
      },
    },
  };

  try {
    const transport = createUploadTransport({
      apiBaseUrl: "http://localhost:3002",
    });
    assert.equal(transport.kind, "electron-ipc");
    const result = await transport.uploadPart(
      "session-1",
      1,
      new Blob(["part"]),
      { onProgress: (bytes) => progress.push(bytes) },
    );

    assert.equal(result.partNumber, 1);
    assert.equal(
      received.url,
      "http://localhost:3002/uploads/session-1/parts/1",
    );
    assert.equal(received.body.byteLength, 4);
    assert.deepEqual(progress, [2, 4]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("没有 IndexedDB 时上传进度仍可通过内存适配器保存和恢复", async () => {
  await saveUploadProgress("session-1", { completedParts: [1, 2] });
  assert.deepEqual(await loadUploadProgress("session-1"), {
    completedParts: [1, 2],
  });
  await removeUploadProgress("session-1");
  assert.equal(await loadUploadProgress("session-1"), null);
});

test("文件指纹变化时不会复用旧的上传会话", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const file = Object.assign(new Blob(["new-content"]), {
    name: "same-name.json",
    lastModified: 1,
  });
  const fileKey = `upload:${file.name}:${file.size}:${file.lastModified}`;
  await saveUploadProgress(fileKey, {
    sessionId: "old-session",
    partSize: 4,
    sha256: "different-content",
    uploadedParts: [1],
  });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (url.endsWith("/uploads/initiate")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { sessionId: "new-session", partSize: 4 },
        }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 201,
    });
  };

  try {
    await uploadFile(file, {
      apiBaseUrl: "http://localhost:3002",
      concurrency: 1,
    });
    assert.equal(calls[0].url.endsWith("/uploads/initiate"), true);
  } finally {
    await removeUploadProgress(fileKey);
    globalThis.fetch = originalFetch;
  }
});

test("uploadFile 串起初始化、分片、合并并报告阶段进度", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (url.endsWith("/uploads/initiate")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { sessionId: "session-1", partSize: 4 },
        }),
        { status: 201 },
      );
    }
    if (url.includes("/parts/")) {
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 201,
      });
    }
    return new Response(
      JSON.stringify({
        success: true,
        data: { id: 1, sha256: "verified" },
      }),
      { status: 201 },
    );
  };

  try {
    const stages = [];
    const result = await uploadFile(new Blob(["abcdefghij"]), {
      apiBaseUrl: "http://localhost:3002",
      concurrency: 2,
      onProgress: ({ stage }) => stages.push(stage),
    });
    assert.equal(result.id, 1);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["POST", "POST", "POST", "POST", "POST"],
    );
    assert.deepEqual(
      [...new Set(stages)],
      ["hashing", "uploading", "verifying", "done"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadFile 恢复会话时只上传服务端缺失的分片", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const file = Object.assign(new Blob(["abcdefghij"]), {
    name: "resume.json",
    lastModified: 2,
  });
  const fileKey = `upload:${file.name}:${file.size}:${file.lastModified}`;
  const sha256 = await sha256Blob(file);
  await saveUploadProgress(fileKey, {
    sessionId: "resume-session",
    partSize: 4,
    sha256,
    uploadedParts: [1],
  });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (url.endsWith("/uploads/resume-session")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            sessionId: "resume-session",
            partSize: 4,
            uploadedParts: [{ partNumber: 1 }],
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 201,
    });
  };

  try {
    await uploadFile(file, {
      apiBaseUrl: "http://localhost:3002",
      concurrency: 2,
    });
    assert.equal(
      calls.some(({ url }) => url.endsWith("/uploads/initiate")),
      false,
    );
    assert.equal(calls.filter(({ url }) => url.includes("/parts/")).length, 2);
  } finally {
    await removeUploadProgress(fileKey);
    globalThis.fetch = originalFetch;
  }
});

test("records survive a new Pinia instance", async () => {
  const firstStore = usePracticeStore();
  firstStore.addRecord({
    questionId: 205,
    userAnswer: "saved answer",
    result: "correct",
  });
  await nextTick();

  setActivePinia(createPinia());
  const restoredStore = usePracticeStore();

  assert.equal(restoredStore.records.length, 1);
  assert.equal(restoredStore.records[0].userAnswer, "saved answer");
});

test("corrupt localStorage falls back to an empty array", () => {
  localStorage.setItem("practice-records", "not-json");
  setActivePinia(createPinia());

  assert.deepEqual(usePracticeStore().records, []);
});

test("addRecord rejects invalid results", () => {
  const store = usePracticeStore();

  assert.throws(
    () =>
      store.addRecord({
        questionId: 205,
        userAnswer: "answer",
        result: "maybe",
      }),
    /Invalid practice result/,
  );
});

test("addRecord rejects invalid practice modes", () => {
  const store = usePracticeStore();

  assert.throws(
    () =>
      store.addRecord({
        questionId: 205,
        userAnswer: "answer",
        result: "correct",
        mode: "unknown",
      }),
    /Invalid practice mode/,
  );
});

test("updateRecord changes the same record without appending", () => {
  const store = usePracticeStore();
  const id = store.addRecord({
    questionId: 205,
    userAnswer: "first answer",
    result: "wrong",
  });
  const practicedAt = store.records[0].practicedAt;

  const updated = store.updateRecord(id, {
    userAnswer: "revised answer",
    result: "partial",
    mode: "view",
  });

  assert.equal(updated, true);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].userAnswer, "revised answer");
  assert.equal(store.records[0].result, "partial");
  assert.equal(store.records[0].mode, "view");
  assert.equal(store.records[0].practicedAt, practicedAt);
});

test("updateRecord returns false when the record is missing", () => {
  const store = usePracticeStore();

  assert.equal(
    store.updateRecord("missing", {
      userAnswer: "answer",
      result: "correct",
    }),
    false,
  );
});

test("updateRecord rejects invalid results", () => {
  const store = usePracticeStore();
  const id = store.addRecord({
    questionId: 205,
    userAnswer: "answer",
    result: "wrong",
  });

  assert.throws(
    () =>
      store.updateRecord(id, {
        userAnswer: "answer",
        result: "maybe",
      }),
    /Invalid practice result/,
  );
});
