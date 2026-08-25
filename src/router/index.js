import { createRouter, createWebHashHistory } from "vue-router";
import HomePage from "../views/HomePage.vue";
import QuestionsPage from "../views/QuestionsPage.vue";
import PracticePage from "../views/PracticePage.vue";
import StatsPage from "../views/StatsPage.vue";
import { cancelPendingRequests } from "../utils/apiClient.js";

const routes = [
  { path: "/", name: "home", component: HomePage },
  { path: "/questions", name: "questions", component: QuestionsPage },
  { path: "/practice", name: "practice", component: PracticePage },
  { path: "/stats", name: "stats", component: StatsPage },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(() => {
  // 离开页面时取消旧页面请求，避免过期响应回写新页面状态。
  cancelPendingRequests("navigation");
  return true;
});

export default router;
