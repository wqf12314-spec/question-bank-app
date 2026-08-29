<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import {
  CirclePause,
  CheckCircle2,
  Download,
  Play,
  RotateCcw,
  Save,
  Square,
  Undo2,
  UploadCloud,
  X,
} from "lucide-vue-next";
import { useAuthStore } from "../stores/auth";
import { uploadFile } from "../utils/uploadClient.js";
import {
  cancelImportJob,
  createImportJob,
  getImportReview,
  publishImportReview,
  rollbackImportReview,
  retryImportJob,
  saveReviewQuestion,
  watchImportJob,
} from "../utils/importJobClient.js";
import { transitionUploadState } from "../utils/uploadState.js";
import { getErrorDetails } from "../utils/errorDisplay.js";
import { canAccess, ROLES } from "../utils/permissions.js";

const authStore = useAuthStore();
const fileInput = ref(null);
const selectedFile = ref(null);
const status = ref("idle");
const stage = ref("idle");
const completedBytes = ref(0);
const totalBytes = ref(0);
const errorMessage = ref("");
const errorRequestId = ref("");
const resultMessage = ref("");
const importJob = ref(null);
const importJobError = ref("");
const importJobRequestId = ref("");
const reviewRequired = ref(false);
const reviewQuestions = ref([]);
const reviewLoading = ref(false);
const reviewAction = ref("");
const reviewError = ref("");
let controller = null;
let stopImportWatch = null;

const isBusy = computed(() =>
  ["hashing", "uploading", "verifying", "processing"].includes(status.value),
);
const canManageImport = computed(() =>
  canAccess(authStore.user, [ROLES.EDITOR, ROLES.ADMIN]),
);
const canPublishImport = computed(() =>
  canAccess(authStore.user, [ROLES.ADMIN]),
);
const progressPercent = computed(() => {
  if (!totalBytes.value) return 0;
  return Math.min(
    100,
    Math.round((completedBytes.value / totalBytes.value) * 100),
  );
});
const stageLabel = computed(
  () =>
    ({
      idle: "等待选择文件",
      hashing: "计算 SHA-256",
      uploading: "上传分片",
      verifying: "服务端校验并合并",
      processing: "后台导入题库",
      paused: "已暂停，可继续",
      done: "上传完成",
      failed: "上传失败",
      cancelled: "已取消",
    })[status.value] || stage.value,
);

function setStatus(next) {
  status.value = transitionUploadState(status.value, next);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function chooseFile() {
  fileInput.value?.click();
}

function handleFileChange(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  selectedFile.value = file;
  totalBytes.value = file.size;
  completedBytes.value = 0;
  status.value = "idle";
  stage.value = "idle";
  errorMessage.value = "";
  errorRequestId.value = "";
  resultMessage.value = "";
  importJob.value = null;
  importJobError.value = "";
  importJobRequestId.value = "";
  reviewQuestions.value = [];
  reviewError.value = "";
  stopImportWatch?.();
  stopImportWatch = null;
}

function updateProgress(progress) {
  stage.value = progress.stage;
  completedBytes.value = progress.completedBytes;
  totalBytes.value = progress.totalBytes;
  setStatus(progress.stage);
}

async function startUpload() {
  if (!selectedFile.value || isBusy.value || !canManageImport.value) return;

  controller = new AbortController();
  errorMessage.value = "";
  resultMessage.value = "";

  try {
    const result = await uploadFile(selectedFile.value, {
      signal: controller.signal,
      onProgress: updateProgress,
    });
    setStatus("done");
    resultMessage.value = "文件已完成上传和完整性校验";
    if (result?.id) {
      setStatus("processing");
      await startImportJob(result.id, result.sha256);
    }
  } catch (error) {
    const reason = controller?.signal.reason;
    if (reason === "paused") {
      setStatus("paused");
      return;
    }
    if (reason === "cancelled") {
      setStatus("cancelled");
      return;
    }
    setStatus("failed");
    errorMessage.value = error?.message || "上传失败，请稍后重试";
    errorRequestId.value = getErrorDetails(error).requestId;
  } finally {
    controller = null;
  }
}

async function startImportJob(fileObjectId, sha256) {
  importJobError.value = "";
  try {
    const pipelineVersion = reviewRequired.value ? "review-v1" : "v1";
    importJob.value = await createImportJob(fileObjectId, {
      pipelineVersion,
      idempotencyKey: sha256 ? `${sha256}:${pipelineVersion}` : undefined,
    });
    stopImportWatch?.();
    stopImportWatch = watchImportJob(importJob.value.id, {
      onEvent: applyImportEvent,
      onError: (error) => {
        importJobError.value = error?.message || "导入进度连接中断，正在重试";
        importJobRequestId.value = getErrorDetails(error).requestId;
      },
    });
  } catch (error) {
    importJobError.value = error?.message || "创建导入任务失败";
    importJobRequestId.value = getErrorDetails(error).requestId;
    setStatus("failed");
  }
}

function applyImportEvent(event) {
  if (!event?.data) return;
  if (
    event.data.id === importJob.value?.id ||
    event.data.jobId === importJob.value?.id
  ) {
    // 收到新事件说明连接已经恢复，避免继续向用户显示过期的断线错误。
    importJobError.value = "";
    importJobRequestId.value = "";
    importJob.value = { ...importJob.value, ...event.data };
    if (event.data.status === "WAITING_REVIEW") void loadImportReview();
    if (["SUCCEEDED", "PARTIAL"].includes(event.data.status)) setStatus("done");
    if (["FAILED", "CANCELLED"].includes(event.data.status))
      setStatus(event.data.status === "FAILED" ? "failed" : "cancelled");
  }
}

async function loadImportReview() {
  if (!importJob.value?.id || reviewLoading.value) return;
  reviewLoading.value = true;
  reviewError.value = "";
  try {
    const review = await getImportReview(importJob.value.id);
    reviewQuestions.value = review.questions.map((question) => ({
      ...question,
      tagsText: question.tags.join(", "),
      saveState: "idle",
    }));
  } catch (error) {
    reviewError.value = getErrorDetails(error).message;
  } finally {
    reviewLoading.value = false;
  }
}

async function saveReviewDraft(question, reason) {
  question.saveState = "saving";
  reviewError.value = "";
  try {
    const updated = await saveReviewQuestion(
      {
        ...question,
        tags: question.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
      { reason },
    );
    Object.assign(question, updated, {
      tagsText: updated.tags.join(", "),
      saveState: "saved",
    });
  } catch (error) {
    question.saveState = "error";
    reviewError.value = getErrorDetails(error).message;
  }
}

function acceptReviewSuggestions(question) {
  const suggestions = question.reviewSuggestions || {};
  if (suggestions.category) question.category = suggestions.category;
  if (suggestions.difficulty) question.difficulty = suggestions.difficulty;
  if (suggestions.answer) question.answer = suggestions.answer;
  void saveReviewDraft(question, "REVIEW_SUGGESTION_ACCEPTED");
}

async function publishReview() {
  reviewAction.value = "publish";
  reviewError.value = "";
  try {
    importJob.value = await publishImportReview(importJob.value.id);
    setStatus("done");
  } catch (error) {
    reviewError.value = getErrorDetails(error).message;
  } finally {
    reviewAction.value = "";
  }
}

async function rollbackReview() {
  reviewAction.value = "rollback";
  reviewError.value = "";
  try {
    importJob.value = await rollbackImportReview(importJob.value.id);
    reviewQuestions.value = [];
    setStatus("cancelled");
  } catch (error) {
    reviewError.value = getErrorDetails(error).message;
  } finally {
    reviewAction.value = "";
  }
}

async function cancelJob() {
  if (!importJob.value?.id) return;
  importJob.value = await cancelImportJob(importJob.value.id);
  setStatus("cancelled");
  stopImportWatch?.();
}

async function retryJob() {
  if (!importJob.value?.id) return;
  importJob.value = await retryImportJob(importJob.value.id);
  setStatus("processing");
  stopImportWatch?.();
  stopImportWatch = watchImportJob(importJob.value.id, {
    onEvent: applyImportEvent,
    onError: (error) => {
      importJobError.value = error?.message || "导入进度连接中断，正在重试";
      importJobRequestId.value = getErrorDetails(error).requestId;
    },
  });
}

function downloadFailureReport() {
  if (!importJob.value?.failureReport) return;
  let report;
  try {
    report = JSON.parse(importJob.value.failureReport);
  } catch {
    report = [{ index: 0, reason: importJob.value.failureReport }];
  }
  const blob = new Blob(
    [JSON.stringify({ jobId: importJob.value.id, failures: report }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `import-failures-${importJob.value.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function pauseUpload() {
  if (!controller) return;
  setStatus("paused");
  controller.abort("paused");
}

function cancelUpload() {
  if (controller) controller.abort("cancelled");
  controller = null;
  setStatus("cancelled");
}

function clearFile() {
  if (isBusy.value) return;
  selectedFile.value = null;
  completedBytes.value = 0;
  totalBytes.value = 0;
  status.value = "idle";
  stage.value = "idle";
  errorMessage.value = "";
  errorRequestId.value = "";
  resultMessage.value = "";
  importJob.value = null;
  importJobError.value = "";
  importJobRequestId.value = "";
  reviewQuestions.value = [];
  reviewError.value = "";
  stopImportWatch?.();
  stopImportWatch = null;
}

onBeforeUnmount(() => {
  controller?.abort("cancelled");
  stopImportWatch?.();
});
</script>

<template>
  <section class="upload-panel page-card" aria-labelledby="upload-panel-title">
    <div class="upload-panel-header">
      <div>
        <h2 id="upload-panel-title">大文件上传</h2>
        <p>
          适合上传面试截图 ZIP、PDF 或大型
          JSON。文件只写入本地演示目录，不是线上对象存储。
        </p>
      </div>
      <UploadCloud :size="24" aria-hidden="true" />
    </div>

    <p v-if="!authStore.user" class="upload-hint">
      登录后才能创建上传会话，访客模式不会上传文件。
    </p>
    <p v-else-if="!canManageImport" class="upload-hint">
      当前账号只能浏览题库，上传和导入需要编辑者或管理员权限。
    </p>

    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept=".zip,.pdf,.json,.png,.jpg,.jpeg,application/zip,application/pdf,application/json,image/*"
      @change="handleFileChange"
    />
    <button
      type="button"
      class="upload-select-button"
      :disabled="isBusy || !canManageImport"
      @click="chooseFile"
    >
      <UploadCloud :size="17" aria-hidden="true" />
      {{ selectedFile ? "重新选择文件" : "选择文件" }}
    </button>

    <div v-if="selectedFile" class="upload-file-summary">
      <div>
        <strong>{{ selectedFile.name }}</strong>
        <span>{{ formatBytes(selectedFile.size) }}</span>
      </div>
      <button
        type="button"
        class="upload-icon-button"
        :disabled="isBusy"
        title="移除文件"
        @click="clearFile"
      >
        <X :size="17" aria-hidden="true" />
      </button>
    </div>

    <div v-if="selectedFile" class="upload-progress-area">
      <div class="upload-progress-heading">
        <span>{{ stageLabel }}</span>
        <strong>{{ progressPercent }}%</strong>
      </div>
      <progress :value="progressPercent" max="100">
        {{ progressPercent }}%
      </progress>
      <p class="upload-progress-detail">
        {{ formatBytes(completedBytes) }} / {{ formatBytes(totalBytes) }}
      </p>
    </div>

    <div v-if="selectedFile" class="upload-actions">
      <button
        v-if="!isBusy && status !== 'done'"
        type="button"
        @click="startUpload"
      >
        <RotateCcw
          v-if="
            status === 'paused' || status === 'failed' || status === 'cancelled'
          "
          :size="16"
          aria-hidden="true"
        />
        <Play v-else :size="16" aria-hidden="true" />
        {{
          status === "paused" || status === "failed" || status === "cancelled"
            ? "继续上传"
            : "开始上传"
        }}
      </button>
      <button
        v-if="isBusy"
        type="button"
        class="upload-secondary-button"
        @click="pauseUpload"
      >
        <CirclePause :size="16" aria-hidden="true" />
        暂停
      </button>
      <button
        v-if="isBusy || status === 'paused'"
        type="button"
        class="upload-secondary-button"
        @click="cancelUpload"
      >
        <Square :size="15" aria-hidden="true" />
        取消
      </button>
    </div>

    <label v-if="selectedFile && !isBusy" class="review-required-option">
      <input v-model="reviewRequired" type="checkbox" />
      先导入为待审核草稿
    </label>

    <p v-if="resultMessage" class="upload-success">{{ resultMessage }}</p>
    <p v-if="errorMessage" class="upload-error">{{ errorMessage }}</p>
    <p v-if="errorRequestId" class="upload-error-request-id">
      请求 ID：{{ errorRequestId }}
    </p>
    <p v-if="status === 'paused'" class="upload-hint">
      已保留已完成分片；重新选择同一文件后会先查询服务端并跳过已上传分片。
    </p>

    <section v-if="importJob" class="import-job-status" aria-live="polite">
      <div class="upload-progress-heading">
        <span>导入任务：{{ importJob.status }}</span>
        <strong>{{
          importJob.totalItems
            ? `${importJob.importedItems || 0}/${importJob.totalItems}`
            : "准备中"
        }}</strong>
      </div>
      <p v-if="importJob.errorMessage || importJobError" class="upload-error">
        {{ importJob.errorMessage || importJobError }}
      </p>
      <p v-if="importJobRequestId" class="upload-error-request-id">
        请求 ID：{{ importJobRequestId }}
      </p>
      <p v-else class="upload-hint">
        已导入 {{ importJob.importedItems || 0 }} 道，重复
        {{ importJob.skippedItems || 0 }} 道，失败
        {{ importJob.failedItems || 0 }} 道。
      </p>
      <div class="upload-actions">
        <button
          v-if="importJob.failureReport"
          type="button"
          class="upload-secondary-button"
          @click="downloadFailureReport"
        >
          <Download :size="16" aria-hidden="true" />下载失败报告
        </button>
        <button
          v-if="
            ['QUEUED', 'PARSING', 'VALIDATING', 'DEDUPING'].includes(
              importJob.status,
            )
          "
          type="button"
          class="upload-secondary-button"
          @click="cancelJob"
        >
          <Square :size="15" aria-hidden="true" />取消导入
        </button>
        <button
          v-if="['FAILED', 'PARTIAL'].includes(importJob.status)"
          type="button"
          @click="retryJob"
        >
          <RotateCcw :size="16" aria-hidden="true" />重试导入
        </button>
      </div>
      <div v-if="importJob.status === 'WAITING_REVIEW'" class="import-review">
        <div class="upload-progress-heading">
          <strong>导入审核</strong>
          <button
            type="button"
            class="upload-secondary-button"
            :disabled="reviewLoading"
            @click="loadImportReview"
          >
            <RotateCcw :size="15" aria-hidden="true" />刷新预览
          </button>
        </div>
        <p v-if="reviewLoading" class="upload-hint">正在读取草稿…</p>
        <p v-if="reviewError" class="upload-error" role="alert">
          {{ reviewError }}
        </p>
        <article
          v-for="question in reviewQuestions"
          :key="question.id"
          class="import-review-question"
        >
          <label>
            题目
            <input v-model.trim="question.title" type="text" />
          </label>
          <label>
            答案
            <textarea v-model="question.answer" rows="4"></textarea>
          </label>
          <label>
            标签
            <input v-model="question.tagsText" type="text" />
          </label>
          <label>
            分类
            <input v-model="question.category" type="text" />
          </label>
          <label>
            难度
            <input v-model="question.difficulty" type="text" />
          </label>
          <section
            v-if="question.reviewSuggestions?.reasons?.length"
            class="import-review-suggestions"
          >
            <strong>本地规则建议</strong>
            <ul>
              <li v-for="reason in question.reviewSuggestions.reasons" :key="reason">
                {{ reason }}
              </li>
            </ul>
            <button
              type="button"
              class="upload-secondary-button"
              :disabled="question.saveState === 'saving'"
              @click="acceptReviewSuggestions(question)"
            >
              <CheckCircle2 :size="15" aria-hidden="true" />采纳建议并保存
            </button>
          </section>
          <button type="button" @click="saveReviewDraft(question)">
            <Save :size="15" aria-hidden="true" />
            {{ question.saveState === "saving" ? "保存中" : "保存修正" }}
          </button>
          <span v-if="question.saveState === 'saved'" class="upload-success">
            已保存
          </span>
        </article>
        <div v-if="canPublishImport" class="upload-actions">
          <button
            type="button"
            :disabled="Boolean(reviewAction)"
            @click="publishReview"
          >
            <CheckCircle2 :size="16" aria-hidden="true" />审核并发布
          </button>
          <button
            type="button"
            class="upload-secondary-button"
            :disabled="Boolean(reviewAction)"
            @click="rollbackReview"
          >
            <Undo2 :size="16" aria-hidden="true" />整批回滚
          </button>
        </div>
        <p v-else class="upload-hint">草稿修正后由管理员审核发布或整批回滚。</p>
      </div>
    </section>
  </section>
</template>
