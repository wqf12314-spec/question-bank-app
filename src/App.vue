<script setup>
import TabNav from "./components/TabNav.vue";
import DataPortability from "./components/DataPortability.vue";
import DesktopShell from "./components/DesktopShell.vue";

const isDesktop = Boolean(window.desktopAPI?.isDesktop);
</script>

<template>
  <DesktopShell v-if="isDesktop" />
  <div v-else class="app-shell">
    <main class="app-main">
      <router-view />
      <details class="web-data-tools">
        <summary>学习数据备份与迁移</summary>
        <DataPortability />
      </details>
    </main>
    <TabNav />
  </div>
</template>

<style scoped>
.web-data-tools {
  max-width: 1160px;
  margin: 18px auto 0;
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
