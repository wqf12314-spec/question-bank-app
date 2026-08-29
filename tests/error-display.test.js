import test from "node:test";
import assert from "node:assert/strict";
import {
  formatErrorMessage,
  getErrorDetails,
} from "../src/utils/errorDisplay.js";

test("error display keeps message and attaches request id for support", () => {
  const details = getErrorDetails(
    { message: "服务暂时不可用", requestId: "req-42" },
    "fallback",
  );
  assert.deepEqual(details, { message: "服务暂时不可用", requestId: "req-42" });
  assert.equal(
    formatErrorMessage({ message: "服务暂时不可用", requestId: "req-42" }),
    "服务暂时不可用（请求 ID：req-42）",
  );
});

test("error display falls back when no request id exists", () => {
  assert.equal(formatErrorMessage({}, "网络失败"), "网络失败");
});
