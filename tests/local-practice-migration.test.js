import assert from "node:assert/strict";
import test from "node:test";
import {
  getLocalMigrationPreview,
  getMigrationDecision,
  markMigrationDecision,
  prepareLocalPracticeRecords,
} from "../src/utils/localPracticeMigration.js";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

test("迁移预览区分可迁移记录和异常记录", () => {
  const storage = createMemoryStorage({
    "practice-records": JSON.stringify([
      { questionId: "205", result: "correct", mode: "write" },
      { questionId: "bad", result: "correct" },
    ]),
  });

  assert.deepEqual(getLocalMigrationPreview(storage), {
    localCount: 2,
    migratableCount: 1,
    invalidCount: 1,
    unreadable: false,
  });
});

test("迁移为旧记录补稳定请求编号且不清空其他本地数据", () => {
  const generatedId = "44444444-4444-4444-8444-444444444444";
  const storage = createMemoryStorage({
    "practice-records": JSON.stringify([
      {
        id: "legacy-1",
        questionId: "205",
        userAnswer: "本地答案",
        result: "partial",
        mode: "view",
        practicedAt: "2026-08-18T09:00:00.000Z",
      },
    ]),
    favorites: '["205"]',
  });

  const first = prepareLocalPracticeRecords(storage, () => generatedId);
  const second = prepareLocalPracticeRecords(storage, () => {
    throw new Error("已有编号时不应再次生成");
  });

  assert.equal(first.records[0].clientRequestId, generatedId);
  assert.deepEqual(second.records, first.records);
  assert.equal(storage.getItem("favorites"), '["205"]');
});

test("首次迁移决定按用户分别保存", () => {
  const storage = createMemoryStorage();

  markMigrationDecision(storage, 10, "kept-local");

  assert.match(getMigrationDecision(storage, 10), /kept-local/);
  assert.equal(getMigrationDecision(storage, 11), null);
});
