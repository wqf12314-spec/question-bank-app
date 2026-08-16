import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalDataBackup,
  parseLocalDataBackup,
  restoreLocalData,
} from "../src/utils/localDataTransfer.js";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    clear() {
      values.clear();
    },
  };
}

test("完整导出所有 localStorage 键，包括未来的收藏数据", () => {
  const storage = createMemoryStorage({
    "practice-records": "[]",
    favorites: '["205"]',
  });

  const backup = createLocalDataBackup(
    storage,
    new Date("2026-08-16T00:00:00.000Z"),
  );

  assert.deepEqual(backup, {
    schemaVersion: 1,
    exportedAt: "2026-08-16T00:00:00.000Z",
    localStorage: {
      "practice-records": "[]",
      favorites: '["205"]',
    },
  });
});

test("导入会替换旧快照，避免残留键污染恢复结果", () => {
  const storage = createMemoryStorage({ obsolete: "true" });
  restoreLocalData(storage, {
    schemaVersion: 1,
    localStorage: { "practice-records": '[{"id":"1"}]' },
  });

  assert.equal(storage.getItem("obsolete"), null);
  assert.equal(storage.getItem("practice-records"), '[{"id":"1"}]');
});

test("拒绝值类型不正确的备份文件", () => {
  assert.throws(
    () =>
      parseLocalDataBackup({
        schemaVersion: 1,
        localStorage: { "practice-records": [] },
      }),
    /必须是字符串/,
  );
});
