<script setup>
import { computed, ref, watch } from "vue";
import { getQuestionHistory } from "../utils/practiceRecords";
import { usePracticeStore } from "../stores/practice";
import { useAuthStore } from "../stores/auth";
import { getErrorDetails } from "../utils/errorDisplay.js";
import { scoreAnswer } from "../utils/answerScoring.js";
import { explainReviewRecommendation } from "../utils/reviewSchedule.js";
import { trackBehavior } from "../utils/behaviorTelemetry.js";

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  showPrevious: {
    type: Boolean,
    default: false,
  },
  showNext: {
    type: Boolean,
    default: true,
  },
  previousLabel: {
    type: String,
    default: "上一题",
  },
  nextLabel: {
    type: String,
    default: "下一题",
  },
});

const emit = defineEmits(["previous", "next"]);
const practiceStore = usePracticeStore();
const authStore = useAuthStore();
const userAnswer = ref("");
const answerMode = ref("text");
const practiceMode = ref("write");
const showAnswer = ref(false);
const currentRecordId = ref(null);
const currentClientRequestId = ref(null);
const savedResult = ref("");
const saving = ref(false);
const saveError = ref("");
const saveErrorRequestId = ref("");
const resultLabelsByMode = {
  write: {
    wrong: "完全不对",
    partial: "部分掌握",
    correct: "基本掌握",
  },
  view: {
    wrong: "没看懂",
    partial: "理解了但写不出",
    correct: "能写出来",
  },
};

const modeLabels = {
  write: "作答模式",
  view: "查看模式",
};

const currentResultLabels = computed(() => {
  return resultLabelsByMode[practiceMode.value];
});

const currentHistory = computed(() => {
  return getQuestionHistory(practiceStore.records, props.question.id);
});
const answerScore = computed(() =>
  scoreAnswer({
    answer: userAnswer.value,
    expected: props.question.answer,
    tags: props.question.tags,
  }),
);

function resetAttempt() {
  userAnswer.value = "";
  showAnswer.value = false;
  currentRecordId.value = null;
  currentClientRequestId.value = null;
  savedResult.value = "";
  saveError.value = "";
  saveErrorRequestId.value = "";
}

function selectPracticeMode(mode) {
  if (practiceMode.value === mode) return;
  practiceMode.value = mode;
  resetAttempt();
}

function toggleAnswer() {
  showAnswer.value = !showAnswer.value;
}

async function saveRecord(result) {
  if (saving.value) return;
  saveError.value = "";
  if (currentClientRequestId.value === null) {
    currentClientRequestId.value = crypto.randomUUID();
  }
  const values = {
    questionId: props.question.id,
    clientRequestId: currentClientRequestId.value,
    userAnswer: userAnswer.value,
    result,
    mode: practiceMode.value,
  };
  trackBehavior("self-rate", { questionId: props.question.id, result });

  saving.value = true;
  try {
    if (currentRecordId.value === null) {
      const saved = await practiceStore.saveRecord(values);
      currentRecordId.value = saved.id;
    } else if (authStore.user) {
      await practiceStore.updateCloudRecord(currentRecordId.value, values);
    } else {
      practiceStore.updateRecord(currentRecordId.value, values);
    }
    savedResult.value = result;
  } catch (error) {
    // 网络失败时保留 clientRequestId，下一次重试仍指向同一业务请求。
    saveError.value = error?.message || "保存练习记录失败，请稍后重试";
    saveErrorRequestId.value = getErrorDetails(error).requestId;
  } finally {
    saving.value = false;
  }
}

function formatPracticeTime(value) {
  return new Date(value).toLocaleString("zh-CN");
}

function getResultLabel(record) {
  const mode = record.mode || "write";
  return resultLabelsByMode[mode]?.[record.result] || record.result;
}

watch(() => props.question.id, resetAttempt);
</script>

<template>
  <article class="page-card practice-panel">
    <header class="practice-heading">
      <div>
        <p class="practice-category">{{ question.category }}</p>
        <h2>{{ question.title }}</h2>
      </div>
      <span class="difficulty-badge">{{ question.difficulty || "基础" }}</span>
    </header>

    <div v-if="question.tags?.length" class="practice-topics">
      <span v-for="topic in question.tags" :key="topic">{{ topic }}</span>
    </div>

    <div class="practice-mode-control" aria-label="刷题模式">
      <button
        type="button"
        :class="{ active: practiceMode === 'write' }"
        :aria-pressed="practiceMode === 'write'"
        @click="selectPracticeMode('write')"
      >
        作答模式
      </button>
      <button
        type="button"
        :class="{ active: practiceMode === 'view' }"
        :aria-pressed="practiceMode === 'view'"
        @click="selectPracticeMode('view')"
      >
        查看模式
      </button>
    </div>

    <div
      v-if="practiceMode === 'write'"
      class="answer-mode-control"
      aria-label="答案输入模式"
    >
      <button
        type="button"
        :class="{ active: answerMode === 'text' }"
        :aria-pressed="answerMode === 'text'"
        @click="answerMode = 'text'"
      >
        文本
      </button>
      <button
        type="button"
        :class="{ active: answerMode === 'code' }"
        :aria-pressed="answerMode === 'code'"
        @click="answerMode = 'code'"
      >
        代码
      </button>
    </div>

    <label v-if="practiceMode === 'write'" class="practice-answer-field">
      <span>我的答案</span>
      <textarea
        v-model="userAnswer"
        :class="{ 'code-mode': answerMode === 'code' }"
        placeholder="先写下自己的理解，再提交答案"
      ></textarea>
    </label>

    <div class="practice-actions">
      <button type="button" class="primary-action" @click="toggleAnswer">
        {{
          showAnswer
            ? "隐藏答案"
            : practiceMode === "write"
              ? "提交答案"
              : "查看答案"
        }}
      </button>
    </div>

    <div v-if="showAnswer" class="practice-reference">
      <p>参考答案</p>
      <div>{{ question.answer || "暂无答案" }}</div>
    </div>

    <div v-if="showAnswer" class="rating-section">
      <p>这次掌握得怎么样？</p>
      <div class="rating-actions">
        <button
          type="button"
          :disabled="saving"
          :class="{ active: savedResult === 'wrong' }"
          @click="saveRecord('wrong')"
        >
          {{ currentResultLabels.wrong }}
        </button>
        <button
          type="button"
          :disabled="saving"
          :class="{ active: savedResult === 'partial' }"
          @click="saveRecord('partial')"
        >
          {{ currentResultLabels.partial }}
        </button>
        <button
          type="button"
          :disabled="saving"
          :class="{ active: savedResult === 'correct' }"
          @click="saveRecord('correct')"
        >
          {{ currentResultLabels.correct }}
        </button>
      </div>

      <p v-if="savedResult" class="save-status">
        已记录：{{ currentResultLabels[savedResult] }}
      </p>
      <p v-if="savedResult" class="save-status">
        复习建议：{{
          explainReviewRecommendation({ result: savedResult })
        }}；关键词覆盖 {{ Math.round(answerScore.keywordCoverage * 100) }}%
      </p>
      <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
      <p v-if="saveErrorRequestId" class="save-error-request-id">
        请求 ID：{{ saveErrorRequestId }}
      </p>

      <button
        v-if="savedResult"
        type="button"
        class="secondary-action"
        @click="resetAttempt"
      >
        重新作答
      </button>
    </div>

    <div v-if="showPrevious || showNext" class="session-navigation">
      <button v-if="showPrevious" type="button" @click="emit('previous')">
        {{ previousLabel }}
      </button>
      <button v-if="showNext" type="button" @click="emit('next')">
        {{ nextLabel }}
      </button>
    </div>

    <section v-if="currentHistory.length" class="review-history">
      <h3>复习记录</h3>
      <article v-for="record in currentHistory" :key="record.id">
        <header>
          <strong>{{ getResultLabel(record) }}</strong>
          <span>{{ modeLabels[record.mode || "write"] }}</span>
          <time :datetime="record.practicedAt">
            {{ formatPracticeTime(record.practicedAt) }}
          </time>
        </header>
        <p>{{ record.userAnswer || "本次未填写答案" }}</p>
      </article>
    </section>
  </article>
</template>
