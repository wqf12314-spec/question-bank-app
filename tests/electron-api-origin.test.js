import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createApiUrlValidator } = require("../electron/api-origin.cjs");

test("Electron API 白名单允许默认服务和显式测试服务", () => {
  const getApiUrl = createApiUrlValidator("http://127.0.0.1:3003");

  assert.equal(
    getApiUrl("http://localhost:3002/questions").pathname,
    "/questions",
  );
  assert.equal(getApiUrl("http://127.0.0.1:3003/health/live").port, "3003");
});

test("Electron API 白名单拒绝未授权域名和非 HTTP 协议", () => {
  const getApiUrl = createApiUrlValidator();

  assert.throws(
    () => getApiUrl("https://attacker.example/questions"),
    /不允许访问该 API/,
  );
  assert.throws(
    () => createApiUrlValidator("file:///tmp/data"),
    /只允许 HTTP\/HTTPS/,
  );
});
