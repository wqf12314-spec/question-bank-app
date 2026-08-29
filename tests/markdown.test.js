import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createPinia, setActivePinia } from "pinia";

test("Markdown 渲染会移除脚本和事件属性", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMPurify = undefined;
  const { renderSafeMarkdown } = await import(
    `../src/utils/markdown.js?case=${Date.now()}`
  );
  const html = renderSafeMarkdown(
    `# 标题\n\n<script>alert(1)</script><img src=x onerror=alert(2)>`,
  );
  assert.match(html, /<h1>标题<\/h1>/);
  assert.doesNotMatch(html, /script|onerror|alert/);
  dom.window.close();
});

test("主题切换只允许中性和专注两种可持久化主题", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const { useThemeStore } = await import(
    `../src/stores/theme.js?case=${Date.now()}`
  );
  setActivePinia(createPinia());
  const store = useThemeStore();
  assert.equal(store.theme, "neutral");
  store.toggle();
  assert.equal(store.theme, "focus");
  assert.equal(storage.get("knowledge-navigator-theme"), "focus");
  store.apply("unexpected");
  assert.equal(store.theme, "neutral");
});

test("前端错误记录保留路由和 requestId，但不保存答案正文", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  storage.set("knowledge-navigator-telemetry-enabled", "true");
  const { recordClientError, readClientErrors } = await import(
    `../src/utils/errorTelemetry.js?case=${Date.now()}`
  );
  recordClientError(
    { message: "失败", code: "E_FAIL", requestId: "req-1" },
    {
      feature: "practice",
      answer: "不得采集",
      nested: { userAnswer: "也不得采集", attempt: 2 },
    },
  );
  const [event] = readClientErrors();
  assert.equal(event.requestId, "req-1");
  assert.equal("answer" in event.context, false);
  assert.deepEqual(event.context.nested, { attempt: 2 });
});

test("复习调度和答案评分提供可解释但非绝对的提示", async () => {
  const { getNextReview, explainReviewRecommendation } = await import(
    `../src/utils/reviewSchedule.js?case=${Date.now()}`
  );
  const { scoreAnswer } = await import(
    `../src/utils/answerScoring.js?case=${Date.now()}`
  );
  const next = getNextReview(
    { result: "correct", reviewLevel: 1 },
    "2026-08-29T00:00:00.000Z",
  );
  assert.equal(next.reviewLevel, 2);
  assert.match(explainReviewRecommendation({ result: "partial" }), /短间隔/);
  const score = scoreAnswer({
    answer: "闭包保存作用域\n- 示例",
    expected: "闭包保存词法作用域",
    tags: ["闭包"],
  });
  assert.equal(score.keywordCoverage, 0.5);
  assert.equal(score.structureCompleteness, 1);
  assert.match(score.note, /不代表绝对正确/);
});

test("行为遥测只保存事件元数据，不保存答案正文", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  storage.set("knowledge-navigator-telemetry-enabled", "true");
  const { trackBehavior, readBehaviorEvents } = await import(
    `../src/utils/behaviorTelemetry.js?case=${Date.now()}`
  );
  trackBehavior("submit", {
    questionId: 1,
    answer: "secret",
    request: { authorization: "Bearer secret", status: 200 },
  });
  assert.deepEqual(readBehaviorEvents()[0].metadata, {
    questionId: 1,
    request: { status: 200 },
  });
});
