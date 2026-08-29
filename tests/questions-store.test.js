import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useQuestionsStore } from "../src/stores/questions.js";
import { clearAccessToken } from "../src/utils/apiClient.js";

const storage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  clear() {
    storage.clear();
  },
};

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

test("store removes saved duplicate titles and keeps the first question", () => {
  const first = { id: 1, title: "什么是闭包？", answer: "第一次导入" };
  const duplicate = { id: 2, title: " 什么是闭包? ", answer: "第二次导入" };
  const unique = { id: 3, title: "什么是事件循环？", answer: "新增题" };
  localStorage.setItem(
    "question-bank",
    JSON.stringify([first, duplicate, unique]),
  );

  const store = useQuestionsStore();

  assert.deepEqual(store.questions, [first, unique]);
  assert.deepEqual(JSON.parse(localStorage.getItem("question-bank")), [
    first,
    unique,
  ]);
});

test("addQuestions reports added and skipped duplicate counts", () => {
  const store = useQuestionsStore();
  store.addQuestion({ id: 1, title: "什么是 Promise？" });

  const result = store.addQuestions([
    { id: 2, title: "什么是 promise?" },
    { id: 3, title: "什么是闭包？" },
  ]);

  assert.deepEqual(result, { addedCount: 1, duplicateCount: 1 });
  assert.equal(store.questions.length, 2);
});

test("clearQuestions removes every question and persists the empty bank", async () => {
  const store = useQuestionsStore();
  store.addQuestions([
    { id: 1, title: "什么是 Promise？" },
    { id: 2, title: "什么是闭包？" },
  ]);

  const removedCount = store.clearQuestions();
  await nextTick();

  assert.equal(removedCount, 2);
  assert.deepEqual(store.questions, []);
  assert.deepEqual(JSON.parse(localStorage.getItem("question-bank")), []);
});

test("store reports success after a server load", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = {};
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        data: [{ id: 1, title: "服务端题目", tags: [] }],
      }),
      { status: 200 },
    );
  try {
    const store = useQuestionsStore();
    await store.loadQuestions();
    assert.equal(store.status, "success");
    assert.equal(store.questions[0].title, "服务端题目");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("store reports error and keeps a local fallback after a failed server load", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  globalThis.window = {};
  console.error = () => {};
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "offline" },
      }),
      { status: 503 },
    );
  try {
    const store = useQuestionsStore();
    await store.loadQuestions();
    assert.equal(store.status, "error");
    assert.equal(store.error, "offline");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("store exits the loading state when the active server load is cancelled", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = {};
  let requestCount = 0;
  globalThis.fetch = async (_url, options) => {
    requestCount += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true },
      );
    });
  };

  try {
    const store = useQuestionsStore();
    const pendingLoad = store.loadQuestions();
    clearAccessToken();
    await pendingLoad;
    await Promise.resolve();

    assert.equal(requestCount, 2);
    assert.equal(store.status, "idle");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
