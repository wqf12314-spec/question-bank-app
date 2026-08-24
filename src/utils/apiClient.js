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

export async function apiFetch(url, options = {}) {
  if (!window.desktopAPI?.request) {
    const response = await fetch(url, options);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      async json() {
        return unwrapApiData(await response.json());
      },
      async text() {
        return response.text();
      },
    };
  }

  // 桌面端由主进程发请求，既避开 file:// 的跨域限制，也不关闭浏览器安全策略。
  const result = await window.desktopAPI.request({
    url,
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
  });

  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    async json() {
      const payload = result.body ? JSON.parse(result.body) : null;
      return unwrapApiData(payload);
    },
    async text() {
      return result.body;
    },
  };
}
