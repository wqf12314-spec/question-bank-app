import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
      "2026-07-23T10:00:00.000Z"
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
    }
  );
});

test("sample question bank follows schema version 1", async () => {
  let content;

  try {
    content = await readFile(
      new URL("../public/sample-question-bank.json", import.meta.url),
      "utf8"
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
