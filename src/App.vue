<script setup>
import { watch } from "vue";
import TabNav from "./components/TabNav.vue";
import DataPortability from "./components/DataPortability.vue";
import DesktopShell from "./components/DesktopShell.vue";
import AccountAccess from "./components/AccountAccess.vue";
import LocalMigrationPreview from "./components/LocalMigrationPreview.vue";
import TelemetrySettings from "./components/TelemetrySettings.vue";
import { useAuthStore } from "./stores/auth";
import { useQuestionsStore } from "./stores/questions";
import { useThemeStore } from "./stores/theme";

const isDesktop = Boolean(window.desktopAPI?.isDesktop);
const authStore = useAuthStore();
const questionsStore = useQuestionsStore();
const themeStore = useThemeStore();
watch(
  () => authStore.user?.id,
  () => {
    // 会话恢复可能取消启动期请求；身份稳定后重新读取当前账号可见题库。
    void questionsStore.loadQuestions();
  },
);
</script>

<template>
  <DesktopShell v-if="isDesktop" />
  <div v-else class="app-shell">
    <main class="app-main">
      <div class="web-account-row">
        <AccountAccess />
        <button
          type="button"
          class="theme-toggle"
          :aria-label="
            themeStore.theme === 'neutral' ? '切换专注主题' : '切换中性主题'
          "
          :title="
            themeStore.theme === 'neutral' ? '切换专注主题' : '切换中性主题'
          "
          @click="themeStore.toggle"
        >
          {{ themeStore.theme === "neutral" ? "专注主题" : "中性主题" }}
        </button>
      </div>
      <p v-if="authStore.isReady && !authStore.user" class="guest-sync-note">
        当前为访客模式：练习记录只保存在本机，不会自动同步到其他设备。
      </p>
      <router-view />
      <details class="privacy-settings">
        <summary>隐私与错误记录</summary>
        <TelemetrySettings />
      </details>
      <details class="web-data-tools">
        <summary>学习数据备份与迁移</summary>
        <DataPortability />
      </details>
    </main>
    <TabNav />
  </div>
  <LocalMigrationPreview />
</template>

<style scoped>
.web-account-row {
  display: flex;
  max-width: 1160px;
  justify-content: flex-end;
  margin: 0 auto 10px;
}

.web-data-tools {
  max-width: 1160px;
  margin: 18px auto 0;
}

.guest-sync-note {
  max-width: 1160px;
  margin: 0 auto 10px;
  color: var(--muted);
  font-size: 13px;
}

.web-data-tools > summary {
  width: fit-content;
  color: var(--muted);
  cursor: pointer;
}

.web-data-tools > :deep(section) {
  margin-top: 10px;
}
</style>
