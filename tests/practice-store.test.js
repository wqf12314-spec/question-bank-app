import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { usePracticeStore } from "../src/stores/practice.js";

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
    userAnswer: "my answer",
    result: "partial",
    mode: "view",
  });

  assert.equal(typeof id, "string");
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].id, id);
  assert.equal(store.records[0].questionId, "205");
  assert.equal(store.records[0].result, "partial");
  assert.equal(store.records[0].mode, "view");
  assert.ok(store.records[0].practicedAt);
  assert.ok(store.records[0].updatedAt);
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
    /Invalid practice result/
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
    /Invalid practice mode/
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
    false
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
    /Invalid practice result/
  );
});
