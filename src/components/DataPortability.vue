<script setup>
import { ref } from "vue";
import { Download, Upload } from "lucide-vue-next";
import { isDesktopApp, persistDesktopData } from "../utils/desktopData";
import {
  createLocalDataBackup,
  restoreLocalData,
} from "../utils/localDataTransfer";

const fileInput = ref(null);
const notice = ref("");
const error = ref("");

async function exportData() {
  notice.value = "";
  error.value = "";
  const payload = createLocalDataBackup(localStorage);

  if (isDesktopApp()) {
    const result = await window.desktopAPI.data.export(payload);
    if (!result.canceled) notice.value = "学习数据已导出";
    return;
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `knowledge-navigator-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  notice.value = "学习数据已导出";
}

async function importData(event) {
  notice.value = "";
  error.value = "";

  try {
    let payload;
    if (isDesktopApp()) {
      payload = await window.desktopAPI.data.import();
      if (!payload) return;
    } else {
      const file = event?.target?.files?.[0];
      if (!file) return;
      payload = await file.text();
    }

    restoreLocalData(localStorage, payload);
    await persistDesktopData();
    notice.value = "数据导入成功，正在重新载入";
    setTimeout(() => window.location.reload(), 250);
  } catch (caughtError) {
    error.value = `导入失败：${caughtError.message}`;
  } finally {
    if (event?.target) event.target.value = "";
  }
}

function chooseImportFile() {
  if (isDesktopApp()) {
    void importData();
    return;
  }
  fileInput.value?.click();
}
</script>

<template>
  <section class="data-portability">
    <div>
      <h2>学习数据</h2>
      <p>迁移练习进度、收藏、离线题库和其他本地设置。</p>
    </div>
    <div class="data-actions">
      <button type="button" @click="exportData">
        <Download :size="17" aria-hidden="true" />
        导出备份
      </button>
      <button type="button" @click="chooseImportFile">
        <Upload :size="17" aria-hidden="true" />
        导入备份
      </button>
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept=".json,application/json"
        @change="importData"
      />
    </div>
    <p v-if="notice" class="data-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="data-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.data-portability {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 2px solid var(--border-strong);
  border-radius: var(--module-radius);
  background: var(--surface-blue);
  box-shadow: var(--panel-shadow);
}

h2,
p {
  margin: 0;
}

h2 {
  font-size: 18px;
}

.data-portability > div > p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 14px;
}

.data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 12px;
  border: 2px solid rgba(64, 165, 174, 0.36);
  border-radius: var(--control-radius);
  background: var(--control-surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.data-notice {
  color: var(--success);
}

.data-error {
  color: var(--danger);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  clip-path: inset(50%);
}
</style>
