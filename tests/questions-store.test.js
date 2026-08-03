import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useQuestionsStore } from "../src/stores/questions.js";

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
    JSON.stringify([first, duplicate, unique])
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
