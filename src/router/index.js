import { createRouter, createWebHashHistory } from "vue-router";
import { cancelPendingRequests } from "../utils/apiClient.js";
import { useAuthStore } from "../stores/auth";
import { canAccess } from "../utils/permissions";

const routes = [
  { path: "/", name: "home", component: () => import("../views/HomePage.vue") },
  {
    path: "/questions",
    name: "questions",
    component: () => import("../views/QuestionsPage.vue"),
    meta: { roles: ["LEARNER", "EDITOR", "ADMIN"] },
  },
  {
    path: "/practice",
    name: "practice",
    component: () => import("../views/PracticePage.vue"),
  },
  {
    path: "/stats",
    name: "stats",
    component: () => import("../views/StatsPage.vue"),
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(async (to) => {
  // 离开页面时取消旧页面请求，避免过期响应回写新页面状态。
  cancelPendingRequests("navigation");
  const allowedRoles = to.meta.roles;
  if (allowedRoles) {
    const authStore = useAuthStore();
    // 刷新受保护页面时先恢复 Cookie/safeStorage 会话，再做角色判断。
    if (!authStore.isReady) await authStore.restore();
    if (!canAccess(authStore.user, allowedRoles)) return "/";
  }
  return true;
});

export default router;
