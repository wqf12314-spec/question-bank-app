import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import {
  ApiError,
  apiFetch,
  cancelPendingRequests,
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

test("concurrent 401 responses share one refresh request and replay once", async () => {
  let refreshCalls = 0;
  let protectedCalls = 0;
  setAccessToken("expired-access-token");

  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(
        JSON.stringify({
          success: true,
          data: { accessToken: "fresh-access-token" },
        }),
        { status: 200 },
      );
    }

    protectedCalls += 1;
    const authorization = options.headers.get("Authorization");
    if (authorization === "Bearer fresh-access-token") {
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Access token expired" },
      }),
      { status: 401, statusText: "Unauthorized" },
    );
  };

  const responses = await Promise.all(
    Array.from({ length: 3 }, () => apiFetch("http://localhost/protected")),
  );

  assert.equal(refreshCalls, 1);
  assert.equal(protectedCalls, 6);
  assert.equal(responses.length, 3);
  assert.deepEqual(await responses[0].json(), { ok: true });
});

test("refresh failure triggers one logout and rejects every waiting request", async () => {
  let refreshCalls = 0;
  let logoutCalls = 0;
  setAccessToken("expired-access-token");

  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "REFRESH_REVOKED", message: "Session revoked" },
        }),
        { status: 401, statusText: "Unauthorized" },
      );
    }
    if (url.endsWith("/auth/logout")) {
      logoutCalls += 1;
      return new Response(JSON.stringify({ success: true, data: { success: true } }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Access token expired" },
      }),
      { status: 401, statusText: "Unauthorized" },
    );
  };

  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () => apiFetch("http://localhost/protected")),
  );

  assert.equal(refreshCalls, 1);
  assert.equal(logoutCalls, 1);
  assert.equal(results.every((result) => result.status === "rejected"), true);
  assert.equal(results[0].reason.code, "REFRESH_REVOKED");
});

test("clearAccessToken cancels an in-flight request", async () => {
  globalThis.fetch = (_url, options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });

  const pending = apiFetch("http://localhost/in-flight");
  clearAccessToken();

  await assert.rejects(
    () => pending,
    (error) => error instanceof ApiError && error.code === "REQUEST_ABORTED",
  );
});

test("navigation cancellation cancels an in-flight request without clearing auth", async () => {
  setAccessToken("still-valid");
  globalThis.fetch = (_url, options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });

  const pending = apiFetch("http://localhost/page-data");
  cancelPendingRequests("navigation");

  await assert.rejects(
    () => pending,
    (error) => error instanceof ApiError && error.code === "REQUEST_ABORTED",
  );

  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.get("Authorization"), "Bearer still-valid");
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
    });
  };
  assert.deepEqual(
    await (await apiFetch("http://localhost/next-page")).json(),
    { ok: true },
  );
});
