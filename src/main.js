import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { initializeDesktopData } from "./utils/desktopData";
import "./style.css";
import "./theme.css";
import { useAuthStore } from "./stores/auth";
import { createPermissionDirective } from "./utils/permissions";
import { recordClientError } from "./utils/errorTelemetry.js";

async function bootstrap() {
  // 桌面数据必须先恢复，再创建会读取 localStorage 的 Pinia Store。
  await initializeDesktopData();
  const pinia = createPinia();
  const app = createApp(App).use(pinia).use(router);
  const authStore = useAuthStore(pinia);
  app.directive(
    "permission",
    createPermissionDirective(() => authStore.user),
  );
  app.config.errorHandler = (error, instance, info) => {
    recordClientError(error, { source: "vue", info });
    console.error(error, instance, info);
  };
  window.addEventListener("error", (event) => {
    recordClientError(event.error || event, { source: "window" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordClientError(event.reason, { source: "promise" });
  });
  app.mount("#app");
  // 页面先可用，再静默恢复 Cookie 或 safeStorage 中的已有会话。
  void authStore.restore();
}

bootstrap();
