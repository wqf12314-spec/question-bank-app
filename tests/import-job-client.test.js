import test from "node:test";
import assert from "node:assert/strict";
import {
  createReviewQuestionPayload,
  parseSseText,
} from "../src/utils/importJobClient.js";

test("SSE parser keeps event id and JSON snapshot data for Last-Event-ID recovery", () => {
  const events = parseSseText(
    [
      "id: 7",
      "event: validating",
      'data: {"status":"VALIDATING","totalItems":3}',
      "",
      "id: 8",
      "event: succeeded",
      'data: {"status":"SUCCEEDED","importedItems":3}',
      "",
    ].join("\n"),
  );
  assert.deepEqual(events, [
    {
      id: "7",
      event: "validating",
      data: { status: "VALIDATING", totalItems: 3 },
    },
    {
      id: "8",
      event: "succeeded",
      data: { status: "SUCCEEDED", importedItems: 3 },
    },
  ]);
});

test("审核修正只发送 Questions PATCH DTO 允许的字段", () => {
  assert.deepEqual(
    createReviewQuestionPayload({
      id: 7,
      title: "修正后的题目",
      answer: "修正后的答案",
      category: "Vue",
      tags: ["响应式"],
      difficulty: "MEDIUM",
      version: 3,
      status: "DRAFT",
      importJobId: "job-1",
    }),
    {
      title: "修正后的题目",
      answer: "修正后的答案",
      category: "Vue",
      tags: ["响应式"],
      difficulty: "MEDIUM",
      version: 3,
    },
  );
});

test("采纳审核建议时把明确的审计原因一起提交", () => {
  assert.deepEqual(
    createReviewQuestionPayload(
      {
        title: "题目",
        answer: "答案",
        category: "前端",
        tags: [],
        difficulty: "进阶",
        version: 2,
      },
      { reason: "REVIEW_SUGGESTION_ACCEPTED" },
    ),
    {
      title: "题目",
      answer: "答案",
      category: "前端",
      tags: [],
      difficulty: "进阶",
      version: 2,
      reason: "REVIEW_SUGGESTION_ACCEPTED",
    },
  );
});
