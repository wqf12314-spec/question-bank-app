export async function apiFetch(url, options = {}) {
  if (!window.desktopAPI?.request) {
    return fetch(url, options);
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
      return result.body ? JSON.parse(result.body) : null;
    },
    async text() {
      return result.body;
    },
  };
}
