import { API_BASE_URL } from "../config/api.js";
import { ApiError, clearAccessToken, setAccessToken } from "./apiClient.js";

function unwrap(payload) {
  return payload?.success === true ? payload.data : payload;
}

async function requestWebSession(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(payload?.error?.message || "账号请求失败", {
      status: response.status,
      code: payload?.error?.code,
      requestId: payload?.error?.requestId,
    });
  }

  return unwrap(payload);
}

export async function loginSession(credentials) {
  const session = window.desktopAPI?.auth?.login
    ? await window.desktopAPI.auth.login({
        url: API_BASE_URL,
        email: credentials.email,
        password: credentials.password,
      })
    : await requestWebSession("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });

  setAccessToken(session.accessToken);
  return session;
}

export async function restoreSession() {
  try {
    const session = window.desktopAPI?.auth?.refresh
      ? await window.desktopAPI.auth.refresh({ url: API_BASE_URL })
      : await requestWebSession("/auth/refresh", { method: "POST" });

    setAccessToken(session.accessToken);
    return session;
  } catch {
    clearAccessToken();
    return null;
  }
}

export async function logoutSession() {
  try {
    if (window.desktopAPI?.auth?.logout) {
      await window.desktopAPI.auth.logout({ url: API_BASE_URL });
    } else {
      await requestWebSession("/auth/logout", { method: "POST" });
    }
  } finally {
    clearAccessToken();
  }
}
