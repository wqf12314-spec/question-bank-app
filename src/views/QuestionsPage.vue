<script setup>
import { computed, ref, watch } from "vue";
import {
  Download,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-vue-next";
import { useQuestionsStore } from "../stores/questions";
import {
  filterQuestions,
  getTopicsForCategory,
  parseTags,
} from "../utils/questionFields";
import {
  createQuestionBankPayload,
  filterNewQuestions,
} from "../utils/questionTransfer";

const questionsStore = useQuestionsStore();
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
const title = ref("");
const answer = ref("");
const category = ref("");
const tagsText = ref("");
const difficulty = ref("基础");
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
    selectedCategory.value
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
});

const filteredQuestions = computed(() => {
  return filterQuestions(
    questionsStore.questions,
    searchKeyword.value,
    selectedTag.value,
    selectedCategory.value
  );
});

watch(selectedCategory, () => {
  selectedTag.value = "";
});

function resetForm() {
  editingId.value = null;
  title.value = "";
  answer.value = "";
  category.value = "";
  tagsText.value = "";
  difficulty.value = "基础";
}

function saveQuestion() {
  if (!title.value.trim()) return;

  const now = new Date().toISOString();
  const formValues = {
    title: title.value.trim(),
    answer: answer.value.trim(),
    category: category.value.trim() || "未分类",
    tags: parseTags(tagsText.value),
    difficulty: difficulty.value,
    updatedAt: now,
  };

  if (editingId.value === null) {
    questionsStore.addQuestion({
      id: Date.now(),
      ...formValues,
      createdAt: now,
    });
  } else {
    const index = questionsStore.questions.findIndex((question) => {
      return question.id === editingId.value;
    });

    if (index !== -1) {
      questionsStore.updateQuestion(index, {
        ...questionsStore.questions[index],
        ...formValues,
      });
    }
  }

  resetForm();
}

function removeQuestion(id) {
  const index = questionsStore.questions.findIndex((question) => {
    return question.id === id;
  });

  if (index !== -1) {
    questionsStore.removeQuestion(index);
  }
}

function clearQuestionBank() {
  const questionCount = questionsStore.questions.length;
  if (questionCount === 0) return;

  const confirmed = window.confirm(
    `确定删除全部 ${questionCount} 道题吗？此操作无法撤销。`
  );
  if (!confirmed) return;

  questionsStore.clearQuestions();
  resetForm();
  searchKeyword.value = "";
  selectedCategory.value = "";
  selectedTag.value = "";
  importNotice.value = `已删除全部 ${questionCount} 道题。`;
}

function startEdit(question) {
  editingId.value = question.id;
  title.value = question.title;
  answer.value = question.answer;
  category.value = question.category;
  tagsText.value = (question.tags || []).join(", ");
  difficulty.value = question.difficulty || "基础";
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

      if (!question || typeof question !== "object" || Array.isArray(question)) {
        throw new Error(`第 ${position} 道题必须是对象`);
      }

      if (typeof question.title !== "string" || !question.title.trim()) {
        throw new Error(`第 ${position} 道题缺少有效的 title`);
      }

      if (question.answer !== undefined && typeof question.answer !== "string") {
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
          `第 ${position} 道题的 difficulty 只能是基础、进阶或困难`
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
      validatedQuestions
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

function confirmImport() {
  if (importPreview.value.length === 0) return;

  const now = new Date().toISOString();
  const previewDuplicateCount = importDuplicateCount.value;
  const questions = importPreview.value.map((question) => ({
    ...question,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));

  const result = questionsStore.addQuestions(questions);
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
      <button type="button" @click="showImport = !showImport">
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
          :disabled="importPreview.length === 0"
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
          <option
            v-for="item in availableCategories"
            :key="item"
            :value="item"
          >
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

    <form class="question-form page-card" @submit.prevent="saveQuestion">
      <div class="form-heading">
        <h2>{{ editingId === null ? "新增题目" : "编辑题目" }}</h2>
      </div>

      <label>
        <span>题目</span>
        <input v-model="title" type="text" placeholder="例如：什么是闭包？" />
      </label>

      <label>
        <span>答案</span>
        <textarea
          v-model="answer"
          placeholder="写下这道题的答案"
        ></textarea>
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
    </form>

    <section class="question-results">
      <header class="results-header">
        <h2>题目列表</h2>
        <p>
          显示 {{ filteredQuestions.length }} 道，共
          {{ questionsStore.questions.length }} 道题
        </p>
      </header>

      <div
        v-if="questionsStore.questions.length === 0"
        class="empty-state"
      >
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
                type="button"
                class="edit-button"
                @click="startEdit(question)"
              >
                <Pencil :size="16" aria-hidden="true" />
                编辑
              </button>
              <button
                type="button"
                class="delete-button"
                @click="removeQuestion(question.id)"
              >
                <Trash2 :size="16" aria-hidden="true" />
                删除
              </button>
            </div>
          </header>
          <p class="question-answer">{{ question.answer }}</p>
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
