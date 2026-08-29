<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  AlertCircle,
  Check,
  Cloud,
  CloudUpload,
  HardDrive,
  RefreshCw,
} from "lucide-vue-next";
import { API_BASE_URL } from "../config/api.js";
import { useAuthStore } from "../stores/auth";
import { usePracticeStore } from "../stores/practice";
import { apiFetch } from "../utils/apiClient.js";
import {
  getLocalMigrationPreview,
  getMigrationDecision,
  markMigrationDecision,
  prepareLocalPracticeRecords,
} from "../utils/localPracticeMigration.js";

const authStore = useAuthStore();
const practiceStore = usePracticeStore();
const dialog = ref(null);
const loading = ref(false);
const migrating = ref(false);
const error = ref("");
const outcome = ref(null);
const preview = ref({
  localCount: 0,
  migratableCount: 0,
  invalidCount: 0,
  unreadable: false,
  cloudCount: null,
  latestPracticedAt: null,
});

async function loadPreview() {
  loading.value = true;
  error.value = "";
  const local = getLocalMigrationPreview(localStorage);
  preview.value = { ...preview.value, ...local, cloudCount: null };

  try {
    const response = await apiFetch(`${API_BASE_URL}/practice-records/summary`);
    const cloud = await response.json();
    preview.value = {
      ...preview.value,
      cloudCount: cloud.practiceRecordCount,
      latestPracticedAt: cloud.latestPracticedAt,
    };
  } catch (caughtError) {
    error.value = `暂时无法读取云端数据：${caughtError.message}`;
  } finally {
    loading.value = false;
  }
}

async function openPreview(force = false) {
  const userId = authStore.user?.id;
  if (!userId || (!force && getMigrationDecision(localStorage, userId))) return;

  outcome.value = null;
  await nextTick();
  if (!dialog.value?.open) dialog.value?.showModal();
  await loadPreview();
}

function closePreview() {
  dialog.value?.close();
}

function keepLocal() {
  markMigrationDecision(localStorage, authStore.user.id, "kept-local");
  outcome.value = {
    title: "已保留本地数据",
    message: "本机记录没有上传，云端记录也没有发生变化。",
  };
}

async function migrateLocalRecords() {
  migrating.value = true;
  error.value = "";
  const prepared = prepareLocalPracticeRecords(localStorage);
  practiceStore.loadRecords();

  if (prepared.unreadable) {
    error.value = "本地练习记录无法解析，请先导出备份后再检查数据。";
    migrating.value = false;
    return;
  }

  let confirmedCount = 0;
  for (const record of prepared.records) {
    try {
      await apiFetch(`${API_BASE_URL}/practice-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      confirmedCount += 1;
    } catch {
      // 已成功的记录可安全保留；再次执行时 clientRequestId 会阻止重复写入。
    }
  }

  migrating.value = false;
  const failedCount = prepared.records.length - confirmedCount;
  if (failedCount > 0) {
    const uploadError = `已确认 ${confirmedCount} 条，另有 ${failedCount} 条未上传。请检查网络后重试。`;
    await loadPreview();
    // 刷新云端数量后仍保留上传结果，避免用户误以为已经全部成功。
    error.value = error.value ? `${uploadError} ${error.value}` : uploadError;
    return;
  }

  markMigrationDecision(localStorage, authStore.user.id, "migrated");
  outcome.value = {
    title: prepared.records.length > 0 ? "迁移完成" : "无需迁移",
    message:
      prepared.records.length > 0
        ? `云端已确认 ${confirmedCount} 条本地练习记录，本地副本仍然保留。`
        : "这台设备暂时没有可迁移的练习记录。",
    invalidCount: prepared.invalidCount,
  };
}

function handleManualOpen() {
  void openPreview(true);
}

watch(
  () => authStore.user?.id,
  (userId) => {
    if (!userId) closePreview();
    else void openPreview();
  },
  { flush: "post" },
);

onMounted(() => {
  window.addEventListener("migration-preview:open", handleManualOpen);
  void openPreview();
});

onBeforeUnmount(() => {
  window.removeEventListener("migration-preview:open", handleManualOpen);
});
</script>

<template>
  <dialog ref="dialog" class="migration-dialog" @cancel="closePreview">
    <section class="migration-content" aria-labelledby="migration-title">
      <header>
        <div class="migration-icon"><CloudUpload :size="22" /></div>
        <div>
          <h2 id="migration-title">检查本地学习记录</h2>
          <p>{{ authStore.user?.email }}</p>
        </div>
      </header>

      <div v-if="outcome" class="migration-outcome" role="status">
        <Check :size="24" aria-hidden="true" />
        <h3>{{ outcome.title }}</h3>
        <p>{{ outcome.message }}</p>
        <p v-if="outcome.invalidCount" class="outcome-warning">
          另有
          {{ outcome.invalidCount }} 条格式异常记录未上传，本地原数据没有删除。
        </p>
        <button type="button" class="primary-action" @click="closePreview">
          完成
        </button>
      </div>

      <template v-else>
        <p class="migration-intro">
          先确认这台设备和云端的数据数量，再决定是否迁移。任何选项都不会清空另一端数据。
        </p>

        <div class="migration-comparison" :aria-busy="loading">
          <div>
            <HardDrive :size="20" aria-hidden="true" />
            <span>这台设备</span>
            <strong>{{ preview.localCount }} 条练习</strong>
            <small v-if="preview.invalidCount">
              {{ preview.invalidCount }} 条需要检查
            </small>
          </div>
          <div>
            <Cloud :size="20" aria-hidden="true" />
            <span>当前账号云端</span>
            <strong>{{
              preview.cloudCount ?? (loading ? "读取中" : "未知")
            }}</strong>
            <small>迁移时只追加，不覆盖</small>
          </div>
        </div>

        <p v-if="preview.unreadable" class="migration-warning" role="alert">
          <AlertCircle :size="17" />
          本地练习记录格式损坏，系统不会自动修改它。
        </p>
        <p v-if="error" class="migration-error" role="alert">{{ error }}</p>

        <div class="migration-actions">
          <button
            type="button"
            class="primary-action"
            :disabled="loading || migrating || preview.cloudCount === null"
            @click="migrateLocalRecords"
          >
            <CloudUpload :size="17" aria-hidden="true" />
            {{
              migrating ? "正在迁移" : `迁移 ${preview.migratableCount} 条记录`
            }}
          </button>
          <button type="button" class="secondary-action" @click="keepLocal">
            保留本地，暂不上传
          </button>
          <button type="button" class="text-action" @click="closePreview">
            稍后处理
          </button>
          <button
            v-if="error"
            type="button"
            class="retry-action"
            :disabled="loading"
            title="重新读取"
            aria-label="重新读取迁移预览"
            @click="loadPreview"
          >
            <RefreshCw :size="17" aria-hidden="true" />
          </button>
        </div>
      </template>
    </section>
  </dialog>
</template>

<style scoped>
.migration-dialog {
  width: min(94vw, 560px);
  max-height: min(88vh, 680px);
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--module-radius);
  color: var(--text);
  background: #fbfefe;
  box-shadow: 0 24px 70px rgba(31, 79, 87, 0.26);
}

.migration-dialog::backdrop {
  background: rgba(28, 52, 57, 0.48);
  backdrop-filter: blur(4px);
}

.migration-content {
  display: grid;
  gap: 18px;
  padding: 22px;
}

header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.migration-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 9px;
  place-items: center;
  color: var(--primary-strong);
  background: var(--primary-soft);
}

h2,
h3,
p {
  margin: 0;
}

h2 {
  font-size: 21px;
}

header p,
.migration-intro,
small {
  color: var(--muted);
}

header p {
  max-width: 34ch;
  margin-top: 2px;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration-intro {
  max-width: 58ch;
  font-size: 14px;
}

.migration-comparison {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: hidden;
  border-block: 1px solid var(--border);
}

.migration-comparison > div {
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 16px;
}

.migration-comparison > div + div {
  border-left: 1px solid var(--border);
}

.migration-comparison svg {
  color: var(--primary);
}

.migration-comparison span {
  font-size: 13px;
  font-weight: 650;
}

.migration-comparison strong {
  font-size: 22px;
}

.migration-comparison small {
  min-height: 20px;
  font-size: 12px;
}

.migration-warning,
.migration-error {
  color: var(--danger);
  font-size: 14px;
}

.migration-warning {
  display: flex;
  align-items: center;
  gap: 7px;
}

.migration-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.migration-actions button,
.migration-outcome button {
  min-height: 40px;
  border-radius: var(--control-radius);
  font: inherit;
  cursor: pointer;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 13px;
}

.primary-action {
  border: 1px solid var(--primary);
  color: #fff;
  background: var(--primary);
}

.secondary-action {
  border: 1px solid var(--border-strong);
  color: var(--text);
  background: var(--control-surface);
}

.text-action,
.retry-action {
  border: 0;
  color: var(--muted);
  background: transparent;
}

.text-action {
  padding: 8px 10px;
}

.retry-action {
  display: grid;
  width: 40px;
  padding: 0;
  place-items: center;
}

button:disabled {
  cursor: wait;
  opacity: 0.58;
}

.migration-outcome {
  display: grid;
  justify-items: start;
  gap: 9px;
  padding-block: 10px 2px;
}

.migration-outcome > svg {
  color: var(--success);
}

.migration-outcome p {
  color: var(--muted);
}

.migration-outcome .outcome-warning {
  color: var(--warning);
  font-size: 13px;
}

.migration-outcome button {
  margin-top: 6px;
}

@media (max-width: 520px) {
  .migration-content {
    padding: 18px;
  }

  .migration-comparison {
    grid-template-columns: 1fr;
  }

  .migration-comparison > div + div {
    border-top: 1px solid var(--border);
    border-left: 0;
  }

  .migration-actions .primary-action,
  .migration-actions .secondary-action {
    width: 100%;
  }
}
</style>
