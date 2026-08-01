<script setup>
import { computed, ref, watch } from "vue";
import PracticeSession from "../components/PracticeSession.vue";
import { useQuestionsStore } from "../stores/questions";
import { usePracticeStore } from "../stores/practice";
import {
  filterRecommendations,
  getTopicsForCategory,
} from "../utils/questionFields";
import { getStats } from "../utils/statistics";

const questionsStore = useQuestionsStore();
const practiceStore = usePracticeStore();
const recommendedQuestion = ref(null);
const selectedCategory = ref("");
const selectedTags = ref([]);

const overview = computed(() => {
  return getStats(questionsStore.questions, practiceStore.records);
});

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

const recommendationPool = computed(() => {
  return filterRecommendations(
    questionsStore.questions,
    selectedCategory.value,
    selectedTags.value
  );
});

function pickRandomQuestion() {
  const questions = recommendationPool.value;

  if (questions.length === 0) {
    recommendedQuestion.value = null;
    return;
  }

  const candidates =
    questions.length > 1 && recommendedQuestion.value
      ? questions.filter((question) => {
          return question.id !== recommendedQuestion.value.id;
        })
      : questions;
  const randomIndex = Math.floor(Math.random() * candidates.length);
  recommendedQuestion.value = candidates[randomIndex];
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
watch(recommendationPool, pickRandomQuestion, { immediate: true });
</script>

<template>
  <section class="home-page">
    <h1 class="page-title">首页</h1>

    <div class="home-filters filter-panel">
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
      当前题池 {{ recommendationPool.length }} 道，共
      {{ questionsStore.questions.length }} 道题
    </p>

    <PracticeSession
      v-if="recommendedQuestion"
      :question="recommendedQuestion"
      next-label="换一题"
      @next="pickRandomQuestion"
    />

    <div v-else class="page-card empty-state">
      <h2>没有符合条件的题目</h2>
      <p>调整一级分类或二级知识点后再试。</p>
    </div>

    <section class="home-overview" aria-label="学习概览">
      <div>
        <span>题库</span>
        <strong>{{ overview.totalQuestions }}</strong>
      </div>
      <div>
        <span>已掌握</span>
        <strong>{{ overview.masteredCount }}</strong>
      </div>
      <div>
        <span>待巩固</span>
        <strong>{{ overview.reviewCount }}</strong>
      </div>
    </section>
  </section>
</template>
