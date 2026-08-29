<script setup>
import { computed } from "vue";
import { useQuestionsStore } from "../stores/questions";
import { usePracticeStore } from "../stores/practice";
import { buildPracticeActivity, getStats } from "../utils/statistics";

const questionsStore = useQuestionsStore();
const practiceStore = usePracticeStore();

const stats = computed(() => {
  return getStats(questionsStore.questions, practiceStore.records);
});

const activity = computed(() => {
  return buildPracticeActivity(practiceStore.records);
});

const recentPracticeCount = computed(() => {
  return activity.value.reduce((total, day) => total + day.count, 0);
});

const metricItems = computed(() => [
  { label: "题库总数", value: stats.value.totalQuestions },
  { label: "练习次数", value: stats.value.practiceCount },
  { label: "已刷题数", value: stats.value.practicedCount },
  { label: "已掌握", value: stats.value.masteredCount },
  { label: "待巩固", value: stats.value.reviewCount },
  { label: "未练习", value: stats.value.unpracticedCount },
]);
</script>

<template>
  <section class="stats-page">
    <h1 class="page-title">学习统计</h1>

    <div class="stats-grid">
      <article v-for="item in metricItems" :key="item.label" class="stats-item">
        <p>{{ item.label }}</p>
        <strong>{{ item.value }}</strong>
      </article>
    </div>

    <div class="page-card progress-card">
      <div class="progress-header">
        <h2>刷题进度</h2>
        <strong>{{ stats.practicePercent }}%</strong>
      </div>
      <div
        class="progress-track"
        role="progressbar"
        aria-label="刷题进度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="stats.practicePercent"
      >
        <div
          class="progress-fill"
          :style="{ width: `${stats.practicePercent}%` }"
        ></div>
      </div>
    </div>

    <section class="page-card activity-card">
      <header>
        <div>
          <h2>每日练习</h2>
          <p>最近 12 周共练习 {{ recentPracticeCount }} 次</p>
        </div>
        <div class="activity-legend" aria-label="练习量颜色说明">
          <span>少</span>
          <i
            v-for="level in [0, 1, 2, 3, 4]"
            :key="level"
            :class="`level-${level}`"
          ></i>
          <span>多</span>
        </div>
      </header>

      <div class="activity-grid" aria-label="最近十二周每日练习量">
        <span
          v-for="day in activity"
          :key="day.date"
          :class="[`level-${day.level}`, { future: day.isFuture }]"
          :title="`${day.date}：${day.count} 次练习`"
          :aria-label="`${day.date}，${day.count} 次练习`"
        ></span>
      </div>
    </section>

    <div class="stats-distributions">
      <div class="page-card stats-distribution-card">
        <h2>一级分类分布</h2>
        <p
          v-if="Object.keys(stats.categoryCounts).length === 0"
          class="empty-state"
        >
          还没有题目分类
        </p>
        <dl v-else class="category-list">
          <div
            v-for="(count, category) in stats.categoryCounts"
            :key="category"
          >
            <dt>{{ category }}</dt>
            <dd>{{ count }} 题</dd>
          </div>
        </dl>
      </div>

      <div class="page-card stats-distribution-card">
        <h2>二级知识点分布</h2>
        <p v-if="Object.keys(stats.tagCounts).length === 0" class="empty-state">
          还没有题目标签
        </p>
        <dl v-else class="category-list">
          <div v-for="(count, tag) in stats.tagCounts" :key="tag">
            <dt>{{ tag }}</dt>
            <dd>{{ count }} 题</dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
