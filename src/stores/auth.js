import { defineStore } from "pinia";
import { ref } from "vue";
import {
  loginSession,
  logoutSession,
  restoreSession,
} from "../utils/authClient.js";
import { recordClientError } from "../utils/errorTelemetry.js";

export const useAuthStore = defineStore("auth", () => {
  // 只保留公开用户信息；长期 Refresh Token 由 Cookie 或 Electron 主进程保管。
  const user = ref(null);
  const isBusy = ref(false);
  const isReady = ref(false);
  const error = ref("");
  const errorRequestId = ref("");
  let restorePromise = null;

  function setUser(nextUser) {
    user.value = nextUser
      ? { id: nextUser.id, email: nextUser.email, role: nextUser.role }
      : null;
  }

  function clearUser() {
    user.value = null;
  }

  async function login(credentials) {
    isBusy.value = true;
    error.value = "";
    errorRequestId.value = "";
    try {
      const session = await loginSession(credentials);
      setUser(session.user);
      return session.user;
    } catch (caughtError) {
      recordClientError(caughtError, { feature: "auth.login" });
      error.value = caughtError?.message || "登录失败，请检查账号和密码";
      errorRequestId.value = caughtError?.requestId || "";
      throw caughtError;
    } finally {
      isBusy.value = false;
      isReady.value = true;
    }
  }

  async function restore() {
    if (isReady.value) return user.value;
    if (!restorePromise) {
      // 路由守卫与应用启动可能同时恢复会话，只允许轮换一次 Refresh Session。
      restorePromise = restoreSession()
        .then((session) => {
          setUser(session?.user ?? null);
          return user.value;
        })
        .finally(() => {
          isReady.value = true;
          restorePromise = null;
        });
    }
    return restorePromise;
  }

  async function logout() {
    isBusy.value = true;
    try {
      await logoutSession();
    } finally {
      clearUser();
      isBusy.value = false;
    }
  }

  function clearError() {
    error.value = "";
    errorRequestId.value = "";
  }

  return {
    user,
    isBusy,
    isReady,
    error,
    errorRequestId,
    setUser,
    clearUser,
    login,
    restore,
    logout,
    clearError,
  };
});
