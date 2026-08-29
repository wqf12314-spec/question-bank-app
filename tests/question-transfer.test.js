import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("question title normalization handles harmless formatting differences", async () => {
  const { normalizeQuestionTitle } =
    await import("../src/utils/questionTransfer.js");

  assert.equal(
    normalizeQuestionTitle("  Vue 3 中 REF 的作用是什么？  "),
    normalizeQuestionTitle("vue3中ref的作用是什么?"),
  );
  assert.notEqual(normalizeQuestionTitle("=="), normalizeQuestionTitle("==="));
});

test("filterNewQuestions skips existing and repeated incoming titles", async () => {
  const { filterNewQuestions } =
    await import("../src/utils/questionTransfer.js");
  const existing = [{ title: "什么是闭包？", answer: "旧答案" }];
  const incoming = [
    { title: " 什么是闭包? ", answer: "重复答案" },
    { title: "Vue 的 ref 是什么？", answer: "新答案" },
    { title: "vue 的 REF 是什么?", answer: "导入文件内部重复" },
    { title: "什么是事件循环？", answer: "新答案" },
  ];

  const result = filterNewQuestions(existing, incoming);

  assert.deepEqual(
    result.questions.map((question) => question.title),
    ["Vue 的 ref 是什么？", "什么是事件循环？"],
  );
  assert.equal(result.duplicateCount, 2);
});

test("dedupeQuestionsByTitle preserves the first saved question", async () => {
  const { dedupeQuestionsByTitle } =
    await import("../src/utils/questionTransfer.js");
  const first = { id: 1, title: "Promise 是什么？", answer: "第一次导入" };
  const duplicate = { id: 2, title: "Promise 是什么?", answer: "第二次导入" };
  const unique = { id: 3, title: "什么是闭包？", answer: "新增" };

  const result = dedupeQuestionsByTitle([first, duplicate, unique]);

  assert.deepEqual(result.questions, [first, unique]);
  assert.equal(result.duplicateCount, 1);
});

test("createQuestionBankPayload creates an import-compatible payload", async () => {
  let transferModule;

  try {
    transferModule = await import("../src/utils/questionTransfer.js");
  } catch {
    transferModule = null;
  }

  assert.ok(transferModule, "question transfer helper should exist");

  const questions = [
    {
      id: "local-id",
      title: "Vue 的 ref 是什么？",
      answer: "创建响应式值。",
      category: "Vue",
      tags: ["Vue", "响应式"],
      difficulty: "基础",
      createdAt: "2026-07-20T00:00:00.000Z",
    },
  ];

  assert.deepEqual(
    transferModule.createQuestionBankPayload(
      questions,
      "2026-07-23T10:00:00.000Z",
    ),
    {
      schemaVersion: 1,
      exportedAt: "2026-07-23T10:00:00.000Z",
      questions: [
        {
          title: "Vue 的 ref 是什么？",
          answer: "创建响应式值。",
          category: "Vue",
          tags: ["Vue", "响应式"],
          difficulty: "基础",
        },
      ],
    },
  );
});

test("sample question bank follows schema version 1", async () => {
  let content;

  try {
    content = await readFile(
      new URL("../public/sample-question-bank.json", import.meta.url),
      "utf8",
    );
  } catch {
    content = null;
  }

  assert.ok(content, "sample question bank should exist");

  const data = JSON.parse(content);
  assert.equal(data.schemaVersion, 1);
  assert.ok(Array.isArray(data.questions));
  assert.ok(data.questions.length >= 5);

  for (const question of data.questions) {
    assert.equal(typeof question.title, "string");
    assert.equal(typeof question.answer, "string");
    assert.equal(typeof question.category, "string");
    assert.ok(Array.isArray(question.tags));
    assert.ok(["基础", "进阶", "困难"].includes(question.difficulty));
  }
});
