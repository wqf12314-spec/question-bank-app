import test from "node:test";
import assert from "node:assert/strict";

test("getQuestionHistory filters by question and sorts newest first", async () => {
  let historyModule;

  try {
    historyModule = await import("../src/utils/practiceRecords.js");
  } catch {
    historyModule = null;
  }

  assert.ok(historyModule, "practice record helper should exist");

  const records = [
    { id: "old", questionId: "205", practicedAt: "2026-07-18T10:00:00.000Z" },
    { id: "other", questionId: "999", practicedAt: "2026-07-19T12:00:00.000Z" },
    { id: "new", questionId: "205", practicedAt: "2026-07-19T10:00:00.000Z" },
  ];
  const originalOrder = records.map((record) => record.id);

  const history = historyModule.getQuestionHistory(records, 205);

  assert.deepEqual(
    history.map((record) => record.id),
    ["new", "old"],
  );
  assert.deepEqual(
    records.map((record) => record.id),
    originalOrder,
  );
});
