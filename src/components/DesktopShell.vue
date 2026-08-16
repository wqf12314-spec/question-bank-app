<script setup>
import { ref } from "vue";
import {
  BarChart3,
  BookOpenCheck,
  LibraryBig,
  Maximize2,
  Minus,
  Pin,
  Settings2,
  X,
} from "lucide-vue-next";
import DataPortability from "./DataPortability.vue";
import PracticePage from "../views/PracticePage.vue";
import QuestionsPage from "../views/QuestionsPage.vue";
import StatsPage from "../views/StatsPage.vue";

const activeTool = ref("questions");
const alwaysOnTop = ref(true);
const desktopWindow = window.desktopAPI.window;

async function toggleAlwaysOnTop() {
  alwaysOnTop.value = await window.desktopAPI.window.setAlwaysOnTop(
    !alwaysOnTop.value,
  );
}
</script>

<template>
  <div class="desktop-shell">
    <header class="desktop-titlebar" @dblclick="desktopWindow.toggleMaximize()">
      <div class="desktop-brand">
        <BookOpenCheck :size="17" aria-hidden="true" />
        <strong>知识航线</strong>
        <span>专注练习</span>
      </div>
      <div class="desktop-window-actions">
        <button
          type="button"
          :class="{ active: alwaysOnTop }"
          :aria-pressed="alwaysOnTop"
          title="始终置顶"
          @click="toggleAlwaysOnTop"
        >
          <Pin :size="15" />
        </button>
        <button type="button" title="最小化" @click="desktopWindow.minimize()">
          <Minus :size="16" />
        </button>
        <button type="button" title="最大化或还原" @click="desktopWindow.toggleMaximize()">
          <Maximize2 :size="14" />
        </button>
        <button class="close-button" type="button" title="关闭" @click="desktopWindow.close()">
          <X :size="16" />
        </button>
      </div>
    </header>

    <main class="desktop-scroll-area">
      <section class="desktop-practice" aria-label="当前练习">
        <PracticePage />
      </section>

      <details class="desktop-tools">
        <summary>
          <span><Settings2 :size="17" />题库与设置</span>
          <small>编辑、统计和数据迁移</small>
        </summary>

        <div class="desktop-tool-tabs" role="tablist" aria-label="次要功能">
          <button
            type="button"
            :class="{ active: activeTool === 'questions' }"
            @click="activeTool = 'questions'"
          >
            <LibraryBig :size="16" />题库
          </button>
          <button
            type="button"
            :class="{ active: activeTool === 'stats' }"
            @click="activeTool = 'stats'"
          >
            <BarChart3 :size="16" />统计
          </button>
          <button
            type="button"
            :class="{ active: activeTool === 'data' }"
            @click="activeTool = 'data'"
          >
            <Settings2 :size="16" />数据
          </button>
        </div>

        <QuestionsPage v-if="activeTool === 'questions'" />
        <StatsPage v-else-if="activeTool === 'stats'" />
        <DataPortability v-else />
      </details>
    </main>
  </div>
</template>

<style scoped>
.desktop-shell {
  height: 100vh;
  overflow: hidden;
  background: rgba(239, 249, 251, 0.9);
}

.desktop-titlebar {
  position: relative;
  z-index: 50;
  display: flex;
  height: 42px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(35, 178, 187, 0.35);
  background: rgba(248, 253, 254, 0.96);
  box-shadow: 0 5px 16px rgba(44, 112, 123, 0.08);
  -webkit-app-region: drag;
}

.desktop-brand {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding-left: 12px;
  color: var(--primary-strong);
}

.desktop-brand strong {
  font-size: 14px;
}

.desktop-brand span {
  color: var(--muted);
  font-size: 12px;
}

.desktop-window-actions {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.desktop-window-actions button {
  display: grid;
  width: 40px;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  place-items: center;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}

.desktop-window-actions button:hover,
.desktop-window-actions button.active {
  color: var(--primary-strong);
  background: var(--primary-soft);
}

.desktop-window-actions .close-button:hover {
  color: #fff;
  background: var(--danger);
}

.desktop-scroll-area {
  height: calc(100vh - 42px);
  padding: 12px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.desktop-tools {
  margin-top: 12px;
  border: 2px solid var(--border-strong);
  border-radius: var(--module-radius);
  background: rgba(248, 253, 254, 0.95);
  box-shadow: var(--panel-shadow);
}

.desktop-tools > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 13px 14px;
  cursor: pointer;
  list-style: none;
}

.desktop-tools > summary::-webkit-details-marker {
  display: none;
}

.desktop-tools > summary span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
}

.desktop-tools > summary small {
  color: var(--muted);
}

.desktop-tool-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin: 0 12px 14px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-soft);
}

.desktop-tool-tabs button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 8px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.desktop-tool-tabs button.active {
  color: #fff;
  background: var(--primary);
}

.desktop-tools > :deep(section) {
  padding: 0 12px 14px;
}

.desktop-tools :deep(.page-title) {
  font-size: 22px;
}

@media (max-width: 410px) {
  .desktop-brand span {
    display: none;
  }

  .desktop-window-actions button {
    width: 36px;
  }
}
</style>
