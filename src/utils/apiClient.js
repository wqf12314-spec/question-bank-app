let accessToken = null;
let refreshPromise = null;
let logoutPromise = null;
let sessionAbortController = new AbortController();
let navigationAbortController = new AbortController();

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

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
  sessionAbortController.abort("logout");
  navigationAbortController.abort("logout");
  sessionAbortController = new AbortController();
  navigationAbortController = new AbortController();
}

export function cancelPendingRequests(reason = "navigation") {
  navigationAbortController.abort(reason);
  navigationAbortController = new AbortController();
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

async function refreshAccessToken(url) {
  const origin = new URL(url).origin;

  if (typeof window !== "undefined" && window.desktopAPI?.auth?.refresh) {
    const result = await window.desktopAPI.auth.refresh({ url: origin });
    if (!result?.accessToken) {
      throw new ApiError("Refresh response is missing access token", {
        code: "REFRESH_FAILED",
      });
    }
    setAccessToken(result.accessToken);
    return result.accessToken;
  }

  const response = await fetch(`${origin}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    throw getApiError(payload, response.status, response.statusText);
  }

  const data = unwrapApiData(payload);
  if (!data?.accessToken) {
    throw new ApiError("Refresh response is missing access token", {
      status: response.status,
      code: "REFRESH_FAILED",
    });
  }
  setAccessToken(data.accessToken);
  return data.accessToken;
}

async function logoutAfterRefreshFailure(url) {
  clearAccessToken();
  const origin = new URL(url).origin;

  try {
    if (typeof window !== "undefined" && window.desktopAPI?.auth?.logout) {
      await window.desktopAPI.auth.logout({ url: origin });
      return;
    }

    // 退出请求绕过 apiFetch，避免刷新失败后再次触发刷新循环。
    await fetch(`${origin}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // 原始刷新错误仍然要返回给所有等待请求，退出清理失败不能遮蔽它。
  }
}

async function runSingleRefresh(url) {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(url).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
async function runSingleLogout(url) {
  if (!logoutPromise) {
    logoutPromise = logoutAfterRefreshFailure(url).finally(() => {
      logoutPromise = null;
    });
  }

  return logoutPromise;
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

async function sendRequest(url, requestOptions, timeoutMs, cancelOnNavigation) {
  const headers = new Headers(requestOptions.headers || {});
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const requestController = new AbortController();
  const requestSignals = [
    requestOptions.signal,
    sessionAbortController.signal,
    cancelOnNavigation ? navigationAbortController.signal : null,
  ];
  const signalListeners = requestSignals.filter(Boolean).map((signal) => {
    const abort = () => requestController.abort(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    return { signal, abort };
  });
  const timeout = createTimeoutController(timeoutMs, requestController.signal);

  try {
    if (typeof window === "undefined" || !window.desktopAPI?.request) {
      const response = await fetch(url, {
        ...requestOptions,
        headers,
        credentials: requestOptions.credentials ?? "include",
        signal: timeout.signal,
      });
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        text: await response.text(),
      };
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

    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers || {},
      text: result.body || "",
    };
  } catch (error) {
    if (timeout.signal.aborted) {
      if (timeout.signal.reason !== "timeout") {
        throw new ApiError("Request was cancelled", {
          code: "REQUEST_ABORTED",
        });
      }
      throw new ApiError("Request timed out", { code: "TIMEOUT" });
    }
    throw error;
  } finally {
    timeout.cleanup();
    signalListeners.forEach(({ signal, abort }) =>
      signal.removeEventListener("abort", abort),
    );
  }
}

function createResponse(raw) {
  const payload = parseJson(raw.text);
  if (!raw.ok) throw getApiError(payload, raw.status, raw.statusText);

  return {
    ok: raw.ok,
    status: raw.status,
    statusText: raw.statusText,
    headers: raw.headers,
    async json() {
      return unwrapApiData(payload);
    },
    async text() {
      return raw.text;
    },
  };
}

export async function apiFetch(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const retryingAfterRefresh = options._authRetry === true;
  const {
    timeoutMs: _timeoutMs,
    _authRetry: _retry,
    cancelOnNavigation = true,
    ...requestOptions
  } = options;
  const raw = await sendRequest(
    url,
    requestOptions,
    timeoutMs,
    cancelOnNavigation,
  );

  if (raw.status === 401 && !retryingAfterRefresh) {
    try {
      await runSingleRefresh(url);
    } catch (error) {
      await runSingleLogout(url);
      throw error;
    }
    return apiFetch(url, { ...options, _authRetry: true });
  }

  return createResponse(raw);
}
