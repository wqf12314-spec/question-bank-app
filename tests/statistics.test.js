import test from "node:test";
import assert from "node:assert/strict";

test("getStats calculates question practice progress", async () => {
  let statisticsModule;

  try {
    statisticsModule = await import("../src/utils/statistics.js");
  } catch {
    statisticsModule = null;
  }

  assert.ok(statisticsModule, "statistics helper should exist");

  const questions = [
    { id: 101, title: "Vue", category: "Vue", tags: ["Vue", "响应式"] },
    { id: 102, title: "JS", category: "JavaScript", tags: ["JavaScript"] },
    { id: 103, title: "CSS", category: "CSS", tags: ["CSS"] },
    { id: 104, title: "HTML", category: "HTML", tags: ["HTML", "Vue"] },
  ];

  const records = [
    { id: "a", questionId: "101", result: "wrong" },
    { id: "b", questionId: "102", result: "correct" },
    { id: "c", questionId: "101", result: "correct" },
  ];

  assert.deepEqual(statisticsModule.getStats(questions, records), {
    totalQuestions: 4,
    practiceCount: 3,
    practicedCount: 2,
    masteredCount: 2,
    reviewCount: 0,
    unpracticedCount: 2,
    practicePercent: 50,
    categoryCounts: {
      Vue: 1,
      JavaScript: 1,
      CSS: 1,
      HTML: 1,
    },
    tagCounts: {
      响应式: 1,
      Vue: 1,
    },
  });
});

test("buildPracticeActivity groups records by day for twelve weeks", async () => {
  const { buildPracticeActivity } = await import("../src/utils/statistics.js");
  const records = [
    { practicedAt: "2026-07-23T01:00:00+08:00" },
    { practicedAt: "2026-07-23T18:00:00+08:00" },
    { practicedAt: "2026-07-24T09:00:00+08:00" },
  ];

  const activity = buildPracticeActivity(
    records,
    84,
    new Date("2026-07-24T12:00:00+08:00")
  );

  assert.equal(activity.length, 84);
  assert.deepEqual(
    activity.find((day) => day.date === "2026-07-23"),
    { date: "2026-07-23", count: 2, level: 2, isFuture: false }
  );
  assert.deepEqual(
    activity.find((day) => day.date === "2026-07-24"),
    { date: "2026-07-24", count: 1, level: 1, isFuture: false }
  );
  assert.equal(
    activity.find((day) => day.date === "2026-07-25").isFuture,
    true
  );
});
