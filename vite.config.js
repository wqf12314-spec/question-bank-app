import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // Source archives without .git still receive the package version.
}
const release = `${packageVersion}+${commit}`;

export default defineConfig(() => ({
  // Electron 从本地 file:// 加载产物，资源必须使用相对路径；网页端保持原配置。
  base:
    process.env.VITE_DESKTOP === "true"
      ? "./"
      : process.env.VITE_BASE_PATH || "/",
  plugins: [vue()],
  define: {
    "import.meta.env.VITE_APP_RELEASE": JSON.stringify(release),
  },
}));
