import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import {
  ApiError,
  apiFetch,
  clearAccessToken,
  setAccessToken,
} from "../src/utils/apiClient.js";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

beforeEach(() => {
  clearAccessToken();
  delete globalThis.window;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

test("apiFetch adds the in-memory access token and includes cookies", async () => {
  let received;
  globalThis.fetch = async (_url, options) => {
    received = options;
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  setAccessToken("access-token-for-test");

  const response = await apiFetch("http://localhost/test", {
    headers: { "Content-Type": "application/json" },
  });

  assert.equal(
    received.headers.get("Authorization"),
    "Bearer access-token-for-test",
  );
  assert.equal(received.credentials, "include");
  assert.deepEqual(await response.json(), { ok: true });
});

test("apiFetch converts API errors into ApiError with code and request id", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions",
          requestId: "req-1",
        },
      }),
      { status: 403, statusText: "Forbidden" },
    );

  await assert.rejects(
    () => apiFetch("http://localhost/protected"),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === "FORBIDDEN" &&
      error.requestId === "req-1" &&
      error.message === "Insufficient permissions",
  );
});

test("apiFetch rejects requests that exceed the timeout", async () => {
  globalThis.fetch = (_url, options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });

  await assert.rejects(
    () => apiFetch("http://localhost/slow", { timeoutMs: 10 }),
    (error) => error instanceof ApiError && error.code === "TIMEOUT",
  );
});
