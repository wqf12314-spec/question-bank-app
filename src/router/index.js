import { createRouter, createWebHashHistory } from "vue-router";
import HomePage from "../views/HomePage.vue";
import QuestionsPage from "../views/QuestionsPage.vue";
import PracticePage from "../views/PracticePage.vue";
import StatsPage from "../views/StatsPage.vue";

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

export default router;
