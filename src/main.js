import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { initializeDesktopData } from "./utils/desktopData";
import "./style.css";
import "./theme.css";

async function bootstrap() {
  // 桌面数据必须先恢复，再创建会读取 localStorage 的 Pinia Store。
  await initializeDesktopData();
  createApp(App).use(createPinia()).use(router).mount("#app");
}

bootstrap();
