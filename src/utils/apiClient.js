let accessToken = null;

export class ApiError extends Error {
  constructor(message, { status = 0, code = "REQUEST_ERROR", requestId } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function setAccessToken(token) {
  accessToken = typeof token === "string" && token.length > 0 ? token : null;
}

export function clearAccessToken() {
  accessToken = null;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unwrapApiData(payload) {
  if (
    payload?.success === true &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    // Store 继续消费原业务数据，响应协议差异集中留在请求层。
    return payload.data;
  }

  return payload;
}

function getApiError(payload, status, statusText) {
  const error = payload?.error;
  return new ApiError(
    typeof error?.message === "string"
      ? error.message
      : statusText || "Request failed",
    {
      status,
      code: typeof error?.code === "string" ? error.code : "REQUEST_ERROR",
      requestId:
        typeof error?.requestId === "string" ? error.requestId : undefined,
    },
  );
}

function createTimeoutController(timeoutMs, callerSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abortCaller = () => controller.abort(callerSignal.reason);
  callerSignal?.addEventListener("abort", abortCaller, { once: true });

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortCaller);
    },
  };
}

async function parseResponse({ ok, status, statusText, headers, text }) {
  const payload = parseJson(text);
  if (!ok) throw getApiError(payload, status, statusText);

  return {
    ok,
    status,
    statusText,
    headers,
    async json() {
      return unwrapApiData(payload);
    },
    async text() {
      return text;
    },
  };
}

export async function apiFetch(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const { timeoutMs: _timeoutMs, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers || {});
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const timeout = createTimeoutController(timeoutMs, requestOptions.signal);

  try {
    if (typeof window === "undefined" || !window.desktopAPI?.request) {
      const response = await fetch(url, {
        ...requestOptions,
        headers,
        credentials: requestOptions.credentials ?? "include",
        signal: timeout.signal,
      });
      return parseResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        text: await response.text(),
      });
    }

    // 桌面端由主进程发请求，既避开 file:// 的跨域限制，也不关闭浏览器安全策略。
    const result = await Promise.race([
      window.desktopAPI.request({
        url,
        method: requestOptions.method || "GET",
        headers: Object.fromEntries(headers.entries()),
        body: requestOptions.body,
      }),
      new Promise((_, reject) => {
        timeout.signal.addEventListener(
          "abort",
          () => reject(new ApiError("Request timed out", { code: "TIMEOUT" })),
          { once: true },
        );
      }),
    ]);

    return parseResponse({
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers || {},
      text: result.body || "",
    });
  } catch (error) {
    if (error?.name === "AbortError" || timeout.signal.aborted) {
      throw new ApiError("Request timed out", { code: "TIMEOUT" });
    }
    throw error;
  } finally {
    timeout.cleanup();
  }
}
