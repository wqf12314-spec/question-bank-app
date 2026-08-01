import test from "node:test";
import assert from "node:assert/strict";

test("parseTags splits, trims, and removes empty tags", async () => {
  let fieldsModule;

  try {
    fieldsModule = await import("../src/utils/questionFields.js");
  } catch {
    fieldsModule = null;
  }

  assert.ok(fieldsModule, "question field helper should exist");
  assert.deepEqual(
    fieldsModule.parseTags("Vue, 响应式, , Proxy"),
    ["Vue", "响应式", "Proxy"]
  );
});

test("filterQuestions combines keyword and exact tag filtering", async () => {
  const { filterQuestions } = await import("../src/utils/questionFields.js");
  const questions = [
    {
      title: "Vue 响应式",
      answer: "使用 Proxy",
      tags: ["Vue", "响应式"],
    },
    {
      title: "JavaScript 闭包",
      answer: "函数和词法环境",
      tags: ["JavaScript"],
    },
  ];

  assert.deepEqual(
    filterQuestions(questions, "proxy", "Vue"),
    [questions[0]]
  );
  assert.deepEqual(filterQuestions(questions, "", ""), questions);
});

test("filterRecommendations requires category and every selected tag", async () => {
  const { filterRecommendations } = await import(
    "../src/utils/questionFields.js"
  );
  const questions = [
    { id: 1, category: "前端", tags: ["Vue", "响应式"] },
    { id: 2, category: "前端", tags: ["Vue"] },
    { id: 3, category: "后端", tags: ["Vue", "响应式"] },
  ];

  assert.deepEqual(
    filterRecommendations(questions, "前端", ["Vue", "响应式"]),
    [questions[0]]
  );
  assert.deepEqual(filterRecommendations(questions, "", []), questions);
});

test("getTopicsForCategory returns only topics under the selected category", async () => {
  const { getTopicsForCategory } = await import(
    "../src/utils/questionFields.js"
  );
  const questions = [
    { category: "Vue", tags: ["ref", "响应式"] },
    { category: "Vue", tags: ["watch", "响应式"] },
    { category: "JavaScript", tags: ["闭包", "作用域"] },
  ];

  assert.deepEqual(getTopicsForCategory(questions, "Vue"), [
    "ref",
    "响应式",
    "watch",
  ]);
  assert.deepEqual(getTopicsForCategory(questions, "JavaScript"), [
    "闭包",
    "作用域",
  ]);
});

test("filterQuestions can combine category, topic, and keyword", async () => {
  const { filterQuestions } = await import("../src/utils/questionFields.js");
  const questions = [
    { title: "watch", answer: "监听", category: "Vue", tags: ["watch"] },
    {
      title: "事件循环",
      answer: "任务队列",
      category: "JavaScript",
      tags: ["异步"],
    },
  ];

  assert.deepEqual(filterQuestions(questions, "监听", "watch", "Vue"), [
    questions[0],
  ]);
  assert.deepEqual(filterQuestions(questions, "", "", "JavaScript"), [
    questions[1],
  ]);
});
