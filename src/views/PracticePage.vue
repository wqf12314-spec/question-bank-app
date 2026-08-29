<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PracticeSession from "../components/PracticeSession.vue";
import { useQuestionsStore } from "../stores/questions";
import {
  filterRecommendations,
  getTopicsForCategory,
} from "../utils/questionFields";
import { getAdjacentQuestion } from "../utils/questionNavigation";
import { trackBehavior } from "../utils/behaviorTelemetry.js";

const route = useRoute();
const router = useRouter();
const questionsStore = useQuestionsStore();
const selectedCategory = ref("");
const selectedTags = ref([]);

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

const practicePool = computed(() => {
  return filterRecommendations(
    questionsStore.questions,
    selectedCategory.value,
    selectedTags.value,
  );
});

const currentQuestion = computed(() => {
  const questionId = route.query.questionId;

  if (questionId === undefined) {
    return practicePool.value[0] || null;
  }

  return (
    practicePool.value.find((question) => {
      return String(question.id) === String(questionId);
    }) ||
    practicePool.value[0] ||
    null
  );
});

function navigateQuestion(offset) {
  if (!currentQuestion.value || practicePool.value.length === 0) return;
  trackBehavior("start-practice", { questionId: currentQuestion.value.id });

  const nextQuestion = getAdjacentQuestion(
    practicePool.value,
    currentQuestion.value.id,
    offset,
  );

  router.push({
    name: "practice",
    query: { questionId: nextQuestion.id },
  });
}

function toggleTag(tag) {
  if (selectedTags.value.includes(tag)) {
    selectedTags.value = selectedTags.value.filter((item) => item !== tag);
    return;
  }

  selectedTags.value = [...selectedTags.value, tag];
}

watch(selectedCategory, () => {
  selectedTags.value = [];
});

watch(
  () => currentQuestion.value?.id,
  (questionId) => {
    if (
      questionId === undefined ||
      String(route.query.questionId) === String(questionId)
    ) {
      return;
    }

    router.replace({
      name: "practice",
      query: { questionId },
    });
  },
  { immediate: true },
);
</script>

<template>
  <section class="practice-page">
    <header class="page-header">
      <h1 class="page-title">刷题</h1>
      <RouterLink class="back-link" to="/questions">返回题库</RouterLink>
    </header>

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

    <div class="home-filters practice-filters filter-panel">
      <label>
        <span>一级分类</span>
        <select v-model="selectedCategory">
          <option value="">全部分类</option>
          <option
            v-for="category in availableCategories"
            :key="category"
            :value="category"
          >
            {{ category }}
          </option>
        </select>
      </label>

      <div
        v-if="selectedCategory && availableTags.length"
        class="home-tag-filter"
      >
        <span>二级知识点</span>
        <div>
          <button
            v-for="tag in availableTags"
            :key="tag"
            type="button"
            :class="{ active: selectedTags.includes(tag) }"
            :aria-pressed="selectedTags.includes(tag)"
            @click="toggleTag(tag)"
          >
            {{ tag }}
          </button>
        </div>
      </div>
    </div>

    <p class="home-pool-summary">
      当前题池 {{ practicePool.length }} 道，共
      {{ questionsStore.questions.length }} 道题
    </p>

    <PracticeSession
      v-if="currentQuestion"
      :question="currentQuestion"
      show-previous
      @previous="navigateQuestion(-1)"
      @next="navigateQuestion(1)"
    />

    <div v-else class="page-card empty-state">
      <h2>没有找到可练习的题目</h2>
      <p>这道题可能已被删除，或者题库还是空的。</p>
      <RouterLink to="/questions">返回题库</RouterLink>
    </div>
  </section>
</template>
