<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  Download,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
  Send,
  CheckCircle2,
  Ban,
  ShieldAlert,
  Eye,
  Code2,
} from "lucide-vue-next";
import { useQuestionsStore } from "../stores/questions";
import { ROLES, canAccess } from "../utils/permissions";
import { useAuthStore } from "../stores/auth";
import {
  filterQuestions,
  getTopicsForCategory,
  parseTags,
} from "../utils/questionFields";
import {
  createQuestionBankPayload,
  filterNewQuestions,
} from "../utils/questionTransfer";
import UploadPanel from "../components/UploadPanel.vue";
import { debounce } from "../utils/debounce.js";
import { getErrorDetails } from "../utils/errorDisplay.js";
import { renderSafeMarkdown } from "../utils/markdown.js";
import { trackBehavior } from "../utils/behaviorTelemetry.js";

const questionsStore = useQuestionsStore();
const authStore = useAuthStore();
const canEdit = computed(() =>
  canAccess(authStore.user, [ROLES.EDITOR, ROLES.ADMIN]),
);
const searchKeyword = ref("");
const selectedCategory = ref("");
const selectedTag = ref("");
const editingId = ref(null);
const showImport = ref(false);
const importText = ref("");
const importPreview = ref([]);
const importDuplicateCount = ref(0);
const importError = ref("");
const importNotice = ref("");
const saveError = ref("");
const saveErrorRequestId = ref("");
const title = ref("");
const answer = ref("");
const category = ref("");
const tagsText = ref("");
const difficulty = ref("基础");
const answerPreview = ref(false);
const conflict = ref(null);
const sampleQuestionBankUrl = `${import.meta.env.BASE_URL}sample-question-bank.json`;

const availableCategories = computed(() => {
  const categories = questionsStore.questions.map((question) => {
    return question.category || "未分类";
  });

  return [...new Set(categories)].sort((a, b) => a.localeCompare(b, "zh-CN"));
});

const availableTags = computed(() => {
  return getTopicsForCategory(
    questionsStore.questions,
    selectedCategory.value,
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
});

const filteredQuestions = computed(() => {
  return filterQuestions(
    questionsStore.questions,
    searchKeyword.value,
    selectedTag.value,
    selectedCategory.value,
  );
});

watch(selectedCategory, () => {
  selectedTag.value = "";
});

// 输入变化先合并，再交给 Store 取消上一条请求，避免快速输入产生请求风暴和旧响应覆盖新结果。
const scheduleSearch = debounce(() => {
  void questionsStore.loadQuestions({
    keyword: searchKeyword.value,
    category: selectedCategory.value,
    tag: selectedTag.value,
  });
}, 250);
watch([searchKeyword, selectedCategory, selectedTag], scheduleSearch);
watch(searchKeyword, (value) => {
  if (value.trim())
    trackBehavior("filter", { keywordLength: value.trim().length });
});
onBeforeUnmount(() => scheduleSearch.cancel());

function resetForm() {
  editingId.value = null;
  title.value = "";
  answer.value = "";
  category.value = "";
  tagsText.value = "";
  difficulty.value = "基础";
  answerPreview.value = false;
}

function fillForm(question) {
  editingId.value = question.id;
  title.value = question.title || "";
  answer.value = question.answer || "";
  category.value = question.category || "";
  tagsText.value = (question.tags || []).join(", ");
  difficulty.value = question.difficulty || "基础";
  answerPreview.value = false;
}

function safeAnswer(answerText) {
  return renderSafeMarkdown(answerText || "");
}

async function saveQuestion() {
  if (!title.value.trim() || !canEdit.value) return;

  const now = new Date().toISOString();
  const formValues = {
    title: title.value.trim(),
    answer: answer.value.trim(),
    category: category.value.trim() || "未分类",
    tags: parseTags(tagsText.value),
    difficulty: difficulty.value,
    updatedAt: now,
  };

  saveError.value = "";
  saveErrorRequestId.value = "";
  try {
    if (editingId.value === null) {
      await questionsStore.addQuestion(formValues);
    } else {
      const index = questionsStore.questions.findIndex((question) => {
        return question.id === editingId.value;
      });

      if (index !== -1) {
        const localDraft = {
          ...questionsStore.questions[index],
          ...formValues,
        };
        try {
          await questionsStore.updateQuestion(index, localDraft);
        } catch (error) {
          if (error?.code !== "QUESTION_VERSION_CONFLICT") throw error;
          await questionsStore.loadQuestions();
          const serverQuestion = questionsStore.questions.find(
            (question) => question.id === localDraft.id,
          );
          conflict.value = serverQuestion
            ? { local: localDraft, server: serverQuestion }
            : null;
          throw error;
        }
      }
    }
    resetForm();
    conflict.value = null;
  } catch (error) {
    if (error?.code === "QUESTION_VERSION_CONFLICT") {
      saveError.value = "这道题已被其他编辑者修改，请比较两个版本后再决定。";
      saveErrorRequestId.value = getErrorDetails(error).requestId;
    } else {
      saveError.value = error?.message || "保存失败，请稍后重试";
      saveErrorRequestId.value = getErrorDetails(error).requestId;
    }
  }
}

async function removeQuestion(id) {
  const index = questionsStore.questions.findIndex((question) => {
    return question.id === id;
  });

  if (index !== -1) {
    await questionsStore.removeQuestion(index);
  }
}

async function changeStatus(question, nextStatus) {
  saveError.value = "";
  try {
    await questionsStore.transitionStatus(question.id, nextStatus);
  } catch (error) {
    saveError.value = error?.message || "更新题目状态失败";
    saveErrorRequestId.value = getErrorDetails(error).requestId;
  }
}

async function clearQuestionBank() {
  const questionCount = questionsStore.questions.length;
  if (questionCount === 0) return;

  const confirmed = window.confirm(
    `确定删除全部 ${questionCount} 道题吗？此操作无法撤销。`,
  );
  if (!confirmed) return;

  const confirmationText = window.prompt(
    "请输入“清空题库”以确认删除全部题目：",
  );

  if (confirmationText !== "清空题库") return;

  await questionsStore.clearQuestions();
  resetForm();
  searchKeyword.value = "";
  selectedCategory.value = "";
  selectedTag.value = "";
  importNotice.value = `已删除全部 ${questionCount} 道题。`;
}

function startEdit(question) {
  conflict.value = null;
  fillForm(question);
}

function useServerVersion() {
  if (!conflict.value?.server) return;
  fillForm(conflict.value.server);
  conflict.value = null;
  saveError.value = "已载入服务器版本。";
}

function retryLocalDraft() {
  if (!conflict.value?.local || !conflict.value?.server) return;
  // 只更新版本号再重试，保留用户本地字段，仍由服务端乐观锁作最后判断。
  fillForm({ ...conflict.value.local, version: conflict.value.server.version });
  conflict.value = null;
  saveError.value =
    "已保留本地修改，并以服务器最新版本为基准；确认后再次保存。";
}

function validateImport() {
  importError.value = "";
  importPreview.value = [];
  importDuplicateCount.value = 0;
  importNotice.value = "";

  try {
    const data = JSON.parse(importText.value);

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("最外层必须是一个 JSON 对象");
    }

    if (data.schemaVersion !== 1) {
      throw new Error("schemaVersion 必须是 1");
    }

    if (!Array.isArray(data.questions)) {
      throw new Error("questions 必须是数组");
    }

    const validatedQuestions = data.questions.map((question, index) => {
      const position = index + 1;

      if (
        !question ||
        typeof question !== "object" ||
        Array.isArray(question)
      ) {
        throw new Error(`第 ${position} 道题必须是对象`);
      }

      if (typeof question.title !== "string" || !question.title.trim()) {
        throw new Error(`第 ${position} 道题缺少有效的 title`);
      }

      if (
        question.answer !== undefined &&
        typeof question.answer !== "string"
      ) {
        throw new Error(`第 ${position} 道题的 answer 必须是字符串`);
      }

      if (
        question.category !== undefined &&
        typeof question.category !== "string"
      ) {
        throw new Error(`第 ${position} 道题的 category 必须是字符串`);
      }

      const tags = question.tags === undefined ? [] : question.tags;
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
        throw new Error(`第 ${position} 道题的 tags 必须是字符串数组`);
      }

      const difficulty = question.difficulty || "基础";
      if (!["基础", "进阶", "困难"].includes(difficulty)) {
        throw new Error(
          `第 ${position} 道题的 difficulty 只能是基础、进阶或困难`,
        );
      }

      return {
        title: question.title.trim(),
        answer: (question.answer || "").trim(),
        category: (question.category || "未分类").trim() || "未分类",
        tags: parseTags(tags.join(",")),
        difficulty,
      };
    });

    if (validatedQuestions.length === 0) {
      throw new Error("questions 中至少需要一道题");
    }

    const result = filterNewQuestions(
      questionsStore.questions,
      validatedQuestions,
    );
    importPreview.value = result.questions;
    importDuplicateCount.value = result.duplicateCount;
  } catch (error) {
    importPreview.value = [];
    importDuplicateCount.value = 0;
    importError.value =
      error instanceof SyntaxError
        ? `JSON 格式错误：${error.message}`
        : error.message;
  }
}

async function loadSampleQuestions() {
  importError.value = "";

  try {
    const response = await fetch(sampleQuestionBankUrl);
    if (!response.ok) {
      throw new Error("示例题库加载失败");
    }

    const data = await response.json();
    importText.value = JSON.stringify(data, null, 2);
    validateImport();
  } catch (error) {
    importPreview.value = [];
    importError.value = error.message;
  }
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  importError.value = "";

  try {
    importText.value = await file.text();
    validateImport();
  } catch (error) {
    importPreview.value = [];
    importError.value = `文件读取失败：${error.message}`;
  } finally {
    event.target.value = "";
  }
}

async function confirmImport() {
  if (importPreview.value.length === 0) return;

  const now = new Date().toISOString();
  const previewDuplicateCount = importDuplicateCount.value;
  const questions = importPreview.value.map((question) => ({
    ...question,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));

  const result = await questionsStore.importQuestions(questions);
  const skippedCount = previewDuplicateCount + result.duplicateCount;
  importNotice.value = `已新增 ${result.addedCount} 道，跳过 ${skippedCount} 道重复题。`;
  importText.value = "";
  importPreview.value = [];
  importDuplicateCount.value = 0;
  importError.value = "";
  showImport.value = false;
}

function exportQuestions() {
  if (questionsStore.questions.length === 0) return;

  const payload = createQuestionBankPayload(questionsStore.questions);
  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `question-bank-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="questions-page">
    <header class="page-header">
      <h1 class="page-title">题库管理</h1>

      <div class="questions-toolbar">
        <button
          type="button"
          :disabled="!canEdit"
          @click="showImport = !showImport"
        >
          <Upload :size="17" aria-hidden="true" />
          {{ showImport ? "收起批量导入" : "批量导入" }}
        </button>
        <button
          type="button"
          :disabled="questionsStore.questions.length === 0"
          @click="exportQuestions"
        >
          <Download :size="17" aria-hidden="true" />
          导出题库
        </button>
        <button
          v-permission="[ROLES.ADMIN]"
          type="button"
          class="clear-button"
          :disabled="questionsStore.questions.length === 0"
          @click="clearQuestionBank"
        >
          <Trash2 :size="17" aria-hidden="true" />
          清空题库
        </button>
      </div>
    </header>

    <p v-if="importNotice" class="import-notice">{{ importNotice }}</p>
    <div
      v-if="questionsStore.status === 'error'"
      class="import-error"
      role="alert"
    >
      <span>{{ questionsStore.error || "题目加载失败" }}</span>
      <small v-if="questionsStore.errorRequestId"
        >请求 ID：{{ questionsStore.errorRequestId }}</small
      >
      <button type="button" @click="questionsStore.loadQuestions()">
        重试
      </button>
    </div>
    <p
      v-else-if="
        questionsStore.status === 'loading' &&
        questionsStore.questions.length === 0
      "
      class="upload-hint"
    >
      正在加载题库...
    </p>

    <UploadPanel />

    <section v-if="!canEdit" class="permission-state page-card" role="status">
      <ShieldAlert :size="22" aria-hidden="true" />
      <div>
        <h2>当前账号只能浏览题库</h2>
        <p>编辑、导入、审核和删除需要编辑者或管理员权限。</p>
      </div>
    </section>

    <section v-if="showImport" class="import-panel">
      <label>
        <span>题库 JSON</span>
        <textarea
          v-model="importText"
          placeholder='粘贴 { "schemaVersion": 1, "questions": [...] }'
        ></textarea>
      </label>

      <label class="import-file-field">
        <span>选择 JSON 文件</span>
        <input
          type="file"
          accept=".json,application/json"
          @change="handleImportFile"
        />
      </label>

      <div class="sample-actions">
        <button type="button" @click="loadSampleQuestions">载入示例</button>
        <a
          class="sample-download"
          :href="sampleQuestionBankUrl"
          download="sample-question-bank.json"
        >
          下载示例 JSON
        </a>
      </div>

      <div class="import-actions">
        <button type="button" @click="validateImport">校验并预览</button>
        <button
          type="button"
          :disabled="!canEdit || importPreview.length === 0"
          @click="confirmImport"
        >
          确认导入 {{ importPreview.length }} 道
        </button>
      </div>

      <p v-if="importError" class="import-error">{{ importError }}</p>

      <p v-if="importDuplicateCount" class="import-duplicate-summary">
        将跳过 {{ importDuplicateCount }} 道重复题。
      </p>

      <div
        v-if="importPreview.length || importDuplicateCount"
        class="import-preview"
      >
        <p>校验通过，可新增 {{ importPreview.length }} 道题：</p>
        <ol>
          <li
            v-for="(question, index) in importPreview"
            :key="`${question.title}-${index}`"
          >
            {{ question.title }} · {{ question.category }} ·
            {{ question.difficulty }}
          </li>
        </ol>
      </div>
    </section>

    <div class="question-filters filter-panel">
      <label class="search-field">
        <span>搜索题目</span>
        <input
          v-model="searchKeyword"
          type="search"
          placeholder="搜索题目、答案或标签"
        />
      </label>

      <label class="category-filter-field">
        <span>一级分类</span>
        <select v-model="selectedCategory">
          <option value="">全部分类</option>
          <option v-for="item in availableCategories" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
      </label>

      <label class="tag-filter-field">
        <span>二级知识点</span>
        <select v-model="selectedTag">
          <option value="">全部知识点</option>
          <option v-for="tag in availableTags" :key="tag" :value="tag">
            {{ tag }}
          </option>
        </select>
      </label>
    </div>

    <form
      v-if="canEdit"
      class="question-form page-card"
      @submit.prevent="saveQuestion"
    >
      <div class="form-heading">
        <h2>{{ editingId === null ? "新增题目" : "编辑题目" }}</h2>
      </div>

      <label>
        <span>题目</span>
        <input v-model="title" type="text" placeholder="例如：什么是闭包？" />
      </label>

      <label>
        <span>答案</span>
        <div
          class="answer-editor-toolbar"
          role="tablist"
          aria-label="答案编辑模式"
        >
          <button
            type="button"
            :class="{ active: !answerPreview }"
            role="tab"
            :aria-selected="!answerPreview"
            @click="answerPreview = false"
          >
            <Code2 :size="15" aria-hidden="true" />编辑
          </button>
          <button
            type="button"
            :class="{ active: answerPreview }"
            role="tab"
            :aria-selected="answerPreview"
            @click="answerPreview = true"
          >
            <Eye :size="15" aria-hidden="true" />预览
          </button>
        </div>
        <textarea
          v-if="!answerPreview"
          v-model="answer"
          placeholder="支持 Markdown，例如 **重点** 或 `代码`"
          aria-label="答案 Markdown 编辑器"
        ></textarea>
        <div
          v-else
          class="markdown-preview answer-preview"
          role="region"
          aria-label="答案 Markdown 预览"
          v-html="safeAnswer(answer)"
        ></div>
      </label>

      <label>
        <span>一级分类</span>
        <input v-model="category" type="text" placeholder="例如：JavaScript" />
      </label>

      <label>
        <span>二级知识点</span>
        <input
          v-model="tagsText"
          type="text"
          placeholder="例如：闭包, 作用域, this"
        />
      </label>

      <label>
        <span>难度</span>
        <select v-model="difficulty">
          <option value="基础">基础</option>
          <option value="进阶">进阶</option>
          <option value="困难">困难</option>
        </select>
      </label>

      <div class="form-actions">
        <button type="submit">
          <Plus v-if="editingId === null" :size="17" aria-hidden="true" />
          <Save v-else :size="17" aria-hidden="true" />
          {{ editingId === null ? "添加题目" : "保存修改" }}
        </button>
        <button
          v-if="editingId !== null"
          type="button"
          class="cancel-button"
          @click="resetForm"
        >
          <X :size="17" aria-hidden="true" />
          取消
        </button>
      </div>
      <p v-if="saveError" class="import-error">{{ saveError }}</p>
      <p v-if="saveErrorRequestId" class="upload-error-request-id">
        请求 ID：{{ saveErrorRequestId }}
      </p>
    </form>

    <section
      v-if="conflict"
      class="conflict-panel page-card"
      aria-live="assertive"
    >
      <header>
        <div>
          <h2>检测到并发修改</h2>
          <p>服务器版本已变化。选择一个版本载入后，再重新保存。</p>
        </div>
        <span class="question-status">409 CONFLICT</span>
      </header>
      <div class="conflict-columns">
        <article>
          <h3>我的版本</h3>
          <dl>
            <dt>版本</dt>
            <dd>{{ conflict.local.version }}</dd>
            <dt>题目</dt>
            <dd>{{ conflict.local.title }}</dd>
            <dt>分类</dt>
            <dd>{{ conflict.local.category }}</dd>
            <dt>答案</dt>
            <dd>{{ conflict.local.answer || "（空）" }}</dd>
          </dl>
        </article>
        <article>
          <h3>服务器版本</h3>
          <dl>
            <dt>版本</dt>
            <dd>{{ conflict.server.version }}</dd>
            <dt>题目</dt>
            <dd>{{ conflict.server.title }}</dd>
            <dt>分类</dt>
            <dd>{{ conflict.server.category }}</dd>
            <dt>答案</dt>
            <dd>{{ conflict.server.answer || "（空）" }}</dd>
          </dl>
        </article>
      </div>
      <div class="form-actions">
        <button type="button" @click="useServerVersion">载入服务器版本</button>
        <button type="button" class="cancel-button" @click="retryLocalDraft">
          保留本地修改
        </button>
      </div>
    </section>

    <section class="question-results">
      <header class="results-header">
        <h2>题目列表</h2>
        <p>
          显示 {{ filteredQuestions.length }} 道，共
          {{ questionsStore.questions.length }} 道题
        </p>
      </header>

      <div v-if="questionsStore.questions.length === 0" class="empty-state">
        <h2>暂无题目</h2>
        <p>添加第一道题后，它会显示在这里。</p>
      </div>

      <div v-else-if="filteredQuestions.length === 0" class="empty-state">
        <h2>没有匹配的题目</h2>
        <p>换一个关键词试试。</p>
      </div>

      <div v-else class="question-list">
        <article
          v-for="question in filteredQuestions"
          :key="question.id"
          class="question-item"
        >
          <header class="question-header">
            <h2>{{ question.title }}</h2>
            <div class="question-actions">
              <span
                class="question-status"
                :data-status="question.status || 'DRAFT'"
                >{{ question.status || "DRAFT" }}</span
              >
              <RouterLink
                class="practice-link"
                :to="{
                  name: 'practice',
                  query: { questionId: question.id },
                }"
              >
                <Play :size="16" aria-hidden="true" />
                开始练习
              </RouterLink>
              <button
                v-permission="[ROLES.EDITOR, ROLES.ADMIN]"
                type="button"
                class="edit-button"
                @click="startEdit(question)"
              >
                <Pencil :size="16" aria-hidden="true" />
                编辑
              </button>
              <button
                v-permission="[ROLES.EDITOR, ROLES.ADMIN]"
                type="button"
                class="delete-button"
                @click="removeQuestion(question.id)"
              >
                <Trash2 :size="16" aria-hidden="true" />
                删除
              </button>
              <button
                v-permission="[ROLES.EDITOR, ROLES.ADMIN]"
                v-if="question.status === 'DRAFT'"
                type="button"
                class="edit-button"
                @click="changeStatus(question, 'IN_REVIEW')"
              >
                <Send :size="16" aria-hidden="true" />提交审核
              </button>
              <button
                v-permission="[ROLES.ADMIN]"
                v-if="question.status === 'IN_REVIEW'"
                type="button"
                class="edit-button"
                @click="changeStatus(question, 'PUBLISHED')"
              >
                <CheckCircle2 :size="16" aria-hidden="true" />发布
              </button>
              <button
                v-permission="[ROLES.ADMIN]"
                v-if="question.status === 'IN_REVIEW'"
                type="button"
                class="delete-button"
                @click="changeStatus(question, 'REJECTED')"
              >
                <Ban :size="16" aria-hidden="true" />驳回
              </button>
            </div>
          </header>
          <div
            class="question-answer markdown-preview"
            v-html="safeAnswer(question.answer)"
          ></div>
          <div class="question-metadata">
            <span class="question-category">{{ question.category }}</span>
            <span class="question-difficulty">
              {{ question.difficulty || "基础" }}
            </span>
            <span
              v-for="tag in question.tags || []"
              :key="tag"
              class="question-tag"
            >
              {{ tag }}
            </span>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.permission-state,
.conflict-panel {
  display: grid;
  gap: 16px;
  margin: 18px 0;
}

.permission-state {
  grid-template-columns: auto 1fr;
  align-items: start;
}

.permission-state h2,
.conflict-panel h2,
.conflict-panel h3 {
  margin: 0;
}

.permission-state p,
.conflict-panel p {
  margin: 6px 0 0;
  color: var(--muted);
}

.conflict-panel > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.conflict-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.conflict-columns article {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.conflict-columns article:first-child {
  border-color: #d89b42;
}

.conflict-columns article:last-child {
  border-color: #4f9d69;
}

.conflict-columns dl {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 7px 10px;
  margin: 12px 0 0;
  overflow-wrap: anywhere;
}

.conflict-columns dt {
  color: var(--muted);
}

.conflict-columns dd {
  margin: 0;
  white-space: pre-wrap;
}

@media (max-width: 680px) {
  .conflict-columns {
    grid-template-columns: 1fr;
  }
}
</style>
