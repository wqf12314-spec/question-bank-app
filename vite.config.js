import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(() => ({
  // Electron 从本地 file:// 加载产物，资源必须使用相对路径；网页端保持原配置。
  base:
    process.env.VITE_DESKTOP === "true"
      ? "./"
      : process.env.VITE_BASE_PATH || "/",
  plugins: [vue()],
}));
