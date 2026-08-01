# Practice Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成刷题记录的新增、修改本次评价、明确重新作答、主动下一题和倒序历史展示。

**Architecture:** `practice.js` 管理记录、校验和 localStorage；纯函数 `practiceRecords.js` 负责筛选排序；`PracticePage.vue` 只管理当前作答状态和用户操作。题目与记录通过字符串形式的 `questionId` 关联。

**Tech Stack:** Vue 3 Composition API、Pinia、Vue Router、localStorage、Node.js test runner。

## Global Constraints

- 首次评价新增记录；同一次作答再次评价更新同一条记录。
- 只有点击“重新作答”或“下一题”才开始新的作答。
- 保存后停留当前题目，不自动跳转。
- 允许空答案保存。
- 结果只允许 `wrong`、`partial`、`correct`。
- 历史记录最新在上，排序不能修改 Store 原数组。
- 当前目录不是 Git 仓库；本计划不初始化 Git，任务以测试和构建通过作为检查点。

## File Map

- Modify: `src/stores/practice.js` - 记录 CRUD、校验、系统字段和持久化。
- Modify: `tests/practice-store.test.js` - Store 行为和持久化测试。
- Create: `src/utils/practiceRecords.js` - 当前题目历史筛选和倒序排序。
- Create: `tests/practice-records.test.js` - 历史排序纯函数测试。
- Modify: `src/views/PracticePage.vue` - 保存、改评、重新作答、下一题和历史 UI。
- Modify: `src/style.css` - 自评按钮、保存状态、历史列表样式。
- Modify: `Vue题库项目学习笔记.md` - 按阶段记录必会知识点和练习。

---

### Task 1: Store 新增记录与持久化

**Files:**
- Modify: `tests/practice-store.test.js`
- Modify: `src/stores/practice.js`

**Interfaces:**
- Produces: `usePracticeStore()`
- Produces: `addRecord({ questionId, userAnswer, result }): string`
- Produces: `loadRecords(): void`

- [ ] **Step 1: 重写 addRecord 测试并加入 localStorage 测试环境**

测试必须断言：Store 生成 UUID、把 `questionId` 转成字符串、添加时间字段并返回记录 id。

```js
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { usePracticeStore } from "../src/stores/practice.js";

const storage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

test("addRecord creates and returns a normalized record", () => {
  const store = usePracticeStore();
  const id = store.addRecord({
    questionId: 205,
    userAnswer: "my answer",
    result: "partial",
  });

  assert.equal(typeof id, "string");
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].id, id);
  assert.equal(store.records[0].questionId, "205");
  assert.equal(store.records[0].result, "partial");
  assert.ok(store.records[0].practicedAt);
  assert.ok(store.records[0].updatedAt);
});

test("records survive a new Pinia instance", async () => {
  const firstStore = usePracticeStore();
  firstStore.addRecord({
    questionId: 205,
    userAnswer: "saved answer",
    result: "correct",
  });
  await nextTick();

  setActivePinia(createPinia());
  const restoredStore = usePracticeStore();

  assert.equal(restoredStore.records.length, 1);
  assert.equal(restoredStore.records[0].userAnswer, "saved answer");
});

test("corrupt localStorage falls back to an empty array", () => {
  localStorage.setItem("practice-records", "not-json");
  setActivePinia(createPinia());

  assert.deepEqual(usePracticeStore().records, []);
});

test("addRecord rejects invalid results", () => {
  const store = usePracticeStore();

  assert.throws(
    () =>
      store.addRecord({
        questionId: 205,
        userAnswer: "answer",
        result: "maybe",
      }),
    /Invalid practice result/
  );
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- tests/practice-store.test.js`

Expected: FAIL，因为当前 `addRecord` 不生成系统字段、不返回 id，也没有持久化。

- [ ] **Step 3: 实现最小 Store**

```js
import { defineStore } from "pinia";
import { ref, watch } from "vue";

const STORAGE_KEY = "practice-records";
const VALID_RESULTS = ["wrong", "partial", "correct"];

export const usePracticeStore = defineStore("practice", () => {
  const records = ref([]);

  function loadRecords() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      records.value = saved ? JSON.parse(saved) : [];
    } catch {
      records.value = [];
    }
  }

  function addRecord({ questionId, userAnswer, result }) {
    if (!VALID_RESULTS.includes(result)) {
      throw new Error("Invalid practice result");
    }

    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      questionId: String(questionId),
      userAnswer: String(userAnswer || "").trim(),
      result,
      practicedAt: now,
      updatedAt: now,
    };

    records.value.push(record);
    return record.id;
  }

  loadRecords();

  watch(
    records,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    },
    { deep: true }
  );

  return { records, addRecord, loadRecords };
});
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- tests/practice-store.test.js`

Expected: 4 tests PASS。

- [ ] **Step 5: 学习检查点**

能够解释：Store 为什么生成 `id` 和时间、为什么 `questionId` 统一为字符串、`try/catch` 如何处理损坏数据。

---

### Task 2: 更新本次评价而不新增记录

**Files:**
- Modify: `tests/practice-store.test.js`
- Modify: `src/stores/practice.js`

**Interfaces:**
- Consumes: `addRecord(...) -> id`
- Produces: `updateRecord(id, { userAnswer, result }): boolean`

- [ ] **Step 1: 写失败测试**

```js
test("updateRecord changes the same record without appending", () => {
  const store = usePracticeStore();
  const id = store.addRecord({
    questionId: 205,
    userAnswer: "first answer",
    result: "wrong",
  });
  const practicedAt = store.records[0].practicedAt;

  const updated = store.updateRecord(id, {
    userAnswer: "revised answer",
    result: "partial",
  });

  assert.equal(updated, true);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].userAnswer, "revised answer");
  assert.equal(store.records[0].result, "partial");
  assert.equal(store.records[0].practicedAt, practicedAt);
});

test("updateRecord returns false when the record is missing", () => {
  const store = usePracticeStore();

  assert.equal(
    store.updateRecord("missing", {
      userAnswer: "answer",
      result: "correct",
    }),
    false
  );
});

test("updateRecord rejects invalid results", () => {
  const store = usePracticeStore();
  const id = store.addRecord({
    questionId: 205,
    userAnswer: "answer",
    result: "wrong",
  });

  assert.throws(
    () =>
      store.updateRecord(id, {
        userAnswer: "answer",
        result: "maybe",
      }),
    /Invalid practice result/
  );
});
```

- [ ] **Step 2: 运行并确认 RED**

Run: `npm test -- tests/practice-store.test.js`

Expected: FAIL with `store.updateRecord is not a function`。

- [ ] **Step 3: 实现 updateRecord**

```js
function updateRecord(id, { userAnswer, result }) {
  if (!VALID_RESULTS.includes(result)) {
    throw new Error("Invalid practice result");
  }

  const record = records.value.find((item) => item.id === id);
  if (!record) return false;

  record.userAnswer = String(userAnswer || "").trim();
  record.result = result;
  record.updatedAt = new Date().toISOString();
  return true;
}
```

把 `updateRecord` 加入 Store 的 `return`。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `npm test -- tests/practice-store.test.js`

Expected: all tests PASS。

- [ ] **Step 5: 学习检查点**

能够解释：为什么更新使用记录 `id`，为什么数组长度保持 1，为什么 `practicedAt` 不变但 `updatedAt` 改变。

---

### Task 3: 当前题目历史倒序

**Files:**
- Create: `tests/practice-records.test.js`
- Create: `src/utils/practiceRecords.js`

**Interfaces:**
- Produces: `getQuestionHistory(records, questionId): Array`

- [ ] **Step 1: 写失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";

test("getQuestionHistory filters by question and sorts newest first", async () => {
  let historyModule;
  try {
    historyModule = await import("../src/utils/practiceRecords.js");
  } catch {
    historyModule = null;
  }
  assert.ok(historyModule, "practice record helper should exist");

  const records = [
    { id: "old", questionId: "205", practicedAt: "2026-07-18T10:00:00.000Z" },
    { id: "other", questionId: "999", practicedAt: "2026-07-19T12:00:00.000Z" },
    { id: "new", questionId: "205", practicedAt: "2026-07-19T10:00:00.000Z" },
  ];
  const originalOrder = records.map((record) => record.id);

  const history = historyModule.getQuestionHistory(records, 205);

  assert.deepEqual(history.map((record) => record.id), ["new", "old"]);
  assert.deepEqual(records.map((record) => record.id), originalOrder);
});
```

- [ ] **Step 2: 运行并确认 RED**

Run: `npm test -- tests/practice-records.test.js`

Expected: FAIL with `practice record helper should exist`。

- [ ] **Step 3: 实现纯函数**

```js
export function getQuestionHistory(records, questionId) {
  const targetId = String(questionId);

  return records
    .filter((record) => record.questionId === targetId)
    .slice()
    .sort((a, b) => {
      return new Date(b.practicedAt) - new Date(a.practicedAt);
    });
}
```

- [ ] **Step 4: 运行并确认 GREEN**

Run: `npm test -- tests/practice-records.test.js`

Expected: PASS。

- [ ] **Step 5: 学习检查点**

能够解释 `filter`、`slice`、`sort` 各自负责什么，以及为什么不能直接排序 Store 原数组。

---

### Task 4: 刷题页保存、改评、重新作答和下一题

**Files:**
- Modify: `src/views/PracticePage.vue`
- Modify: `src/style.css`
- Modify: `Vue题库项目学习笔记.md`

**Interfaces:**
- Consumes: `usePracticeStore()`、`addRecord`、`updateRecord`
- Consumes: `getQuestionHistory(records, questionId)`
- Produces: 完整的当前作答流程和历史 UI

- [ ] **Step 1: 接入页面状态与 Store**

在 `PracticePage.vue` 中导入 `useRouter`、`usePracticeStore` 和 `getQuestionHistory`，增加：

```js
const router = useRouter();
const practiceStore = usePracticeStore();
const currentRecordId = ref(null);
const savedResult = ref("");

const resultLabels = {
  wrong: "完全不对",
  partial: "部分掌握",
  correct: "基本掌握",
};

const currentHistory = computed(() => {
  if (!currentQuestion.value) return [];
  return getQuestionHistory(
    practiceStore.records,
    currentQuestion.value.id
  );
});
```

- [ ] **Step 2: 实现新增与改评**

```js
function saveRecord(result) {
  if (!currentQuestion.value) return;

  const values = {
    questionId: currentQuestion.value.id,
    userAnswer: userAnswer.value,
    result,
  };

  if (currentRecordId.value === null) {
    currentRecordId.value = practiceStore.addRecord(values);
    savedResult.value = result;
    return;
  }

  const updated = practiceStore.updateRecord(currentRecordId.value, values);
  if (updated) savedResult.value = result;
}
```

- [ ] **Step 3: 实现状态重置、重新作答和下一题**

```js
function resetAttempt() {
  userAnswer.value = "";
  showAnswer.value = false;
  currentRecordId.value = null;
  savedResult.value = "";
}

function restartAttempt() {
  resetAttempt();
}

function goToNextQuestion() {
  if (!currentQuestion.value || questionsStore.questions.length === 0) return;

  const currentIndex = questionsStore.questions.findIndex((question) => {
    return String(question.id) === String(currentQuestion.value.id);
  });
  const nextIndex = (currentIndex + 1) % questionsStore.questions.length;
  const nextQuestion = questionsStore.questions[nextIndex];

  resetAttempt();
  router.push({
    name: "practice",
    query: { questionId: nextQuestion.id },
  });
}
```

让现有 `watch(currentQuestion, ...)` 调用 `resetAttempt()`。

- [ ] **Step 4: 添加自评和状态 UI**

参考答案展开后显示：

```vue
<div v-if="showAnswer" class="rating-section">
  <p>这次掌握得怎么样？</p>
  <div class="rating-actions">
    <button
      type="button"
      :class="{ active: savedResult === 'wrong' }"
      @click="saveRecord('wrong')"
    >完全不对</button>
    <button
      type="button"
      :class="{ active: savedResult === 'partial' }"
      @click="saveRecord('partial')"
    >部分掌握</button>
    <button
      type="button"
      :class="{ active: savedResult === 'correct' }"
      @click="saveRecord('correct')"
    >基本掌握</button>
  </div>

  <p v-if="savedResult" class="save-status">
    已记录：{{ resultLabels[savedResult] }}
  </p>

  <div v-if="savedResult" class="attempt-actions">
    <button type="button" @click="restartAttempt">重新作答</button>
    <button type="button" @click="goToNextQuestion">下一题</button>
  </div>
</div>
```

评价按钮始终可点击；改点时更新当前记录。

- [ ] **Step 5: 添加当前题目历史 UI**

```vue
<section v-if="currentHistory.length" class="review-history">
  <h2>复习记录</h2>
  <article v-for="record in currentHistory" :key="record.id">
    <header>
      <strong>{{ resultLabels[record.result] }}</strong>
      <time :datetime="record.practicedAt">
        {{ new Date(record.practicedAt).toLocaleString() }}
      </time>
    </header>
    <p>{{ record.userAnswer || "本次未填写答案" }}</p>
  </article>
</section>
```

- [ ] **Step 6: 添加 CSS**

在 `src/style.css` 中加入：

```css
.rating-section {
  margin-top: 16px;
}

.rating-section > p {
  margin: 0 0 8px;
}

.rating-actions,
.attempt-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rating-actions button,
.attempt-actions button {
  flex: 1 1 120px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: transparent;
  color: #f3f7ff;
  font: inherit;
  cursor: pointer;
}

.rating-actions button.active {
  border-color: #35b87f;
  background: rgba(53, 184, 127, 0.14);
}

.save-status {
  margin: 12px 0;
  color: #55d49e;
  font-weight: 700;
}

.review-history {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.review-history h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

.review-history article {
  padding: 12px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.review-history article header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
}

.review-history article p {
  margin: 8px 0 0;
  line-height: 1.6;
  white-space: pre-wrap;
}
```

- [ ] **Step 7: 运行自动验证**

Run: `npm test`

Expected: all tests PASS。

Run: `npm run build`

Expected: Vite build succeeds with no errors。

- [ ] **Step 8: 浏览器流程验证**

使用本地 Edge/Chrome 验证：

```text
第一次点“部分掌握” -> 历史新增 1 条
改点“基本掌握”     -> 历史仍为 1 条，评价更新
点击“重新作答”后保存 -> 历史变为 2 条
刷新页面             -> 两条记录仍存在
点击“下一题”         -> query.questionId 更新，作答框清空
```

- [ ] **Step 9: 更新学习笔记**

记录：`currentRecordId` 状态机、add/update 分支、`filter + slice + sort`、路由下一题和本轮实操作业。

---

## Final Verification

- [ ] Run: `npm test`
- [ ] Run: `npm run build`
- [ ] 浏览器执行完整新增、改评、重新作答、下一题、刷新恢复流程。
- [ ] 确认 Obsidian 学习笔记包含“必须掌握 / 先看懂 / 实操作业”。
