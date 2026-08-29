import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { API_BASE_URL } from "../config/api.js";
import { apiFetch } from "../utils/apiClient.js";
import { recordClientError } from "../utils/errorTelemetry.js";
import {
  dedupeQuestionsByTitle,
  filterNewQuestions,
} from "../utils/questionTransfer.js";

export const useQuestionsStore = defineStore("questions", () => {
  const questions = ref([]);
  const status = ref("idle");
  const error = ref("");
  const errorRequestId = ref("");
  let loadController = null;

  function addQuestion(question) {
    // 测试环境没有浏览器窗口，保留同步本地行为；真实页面走数据库。
    if (typeof window === "undefined") {
      return addQuestions([question]);
    }
    return createQuestion(question);
  }

  async function createQuestion(question) {
    const response = await apiFetch(`${API_BASE_URL}/questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: question.title,
        answer: question.answer,
        category: question.category,
        tags: question.tags,
        difficulty: question.difficulty,
      }),
    });
    if (!response.ok) {
      throw new Error("添加题目失败");
    }
    const createdQuestion = await response.json();
    questions.value.push(createdQuestion);
    return createdQuestion;
  }

  function addQuestions(nextQuestions) {
    const result = filterNewQuestions(questions.value, nextQuestions);
    questions.value.push(...result.questions);

    return {
      addedCount: result.questions.length,
      duplicateCount: result.duplicateCount,
    };
  }

  async function importQuestions(nextQuestions) {
    const response = await apiFetch(`${API_BASE_URL}/questions/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 后端以 schemaVersion 校验整份题库，以标题统一查重。
      body: JSON.stringify({
        schemaVersion: 1,
        questions: nextQuestions,
      }),
    });

    if (!response.ok) {
      throw new Error("批量导入失败");
    }

    const result = await response.json();
    // 重新读取数据库，避免前端只根据本地推测导入结果。
    await loadQuestions();

    return {
      addedCount: result.importedCount,
      duplicateCount: result.skippedCount,
    };
  }

  function updateQuestion(index, nextQuestion) {
    if (typeof window === "undefined") {
      questions.value[index] = nextQuestion;
      return nextQuestion;
    }
    return updateQuestionOnServer(index, nextQuestion);
  }

  async function updateQuestionOnServer(index, nextQuestion) {
    const currentQuestion = questions.value[index];
    const response = await apiFetch(
      `${API_BASE_URL}/questions/${currentQuestion.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // 只发送后端 DTO 允许的字段，不把前端临时状态一起传过去。
        body: JSON.stringify({
          title: nextQuestion.title,
          answer: nextQuestion.answer,
          category: nextQuestion.category,
          tags: nextQuestion.tags,
          difficulty: nextQuestion.difficulty,
          version: nextQuestion.version,
        }),
      },
    );

    if (!response.ok) {
      throw new Error("更新题目失败");
    }

    const updatedQuestion = await response.json();
    questions.value[index] = updatedQuestion;
    return updatedQuestion;
  }

  async function transitionStatus(questionId, nextStatus) {
    const response = await apiFetch(
      `${API_BASE_URL}/questions/${questionId}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      },
    );
    if (!response.ok) throw new Error("更新题目状态失败");
    const updated = await response.json();
    const index = questions.value.findIndex(
      (question) => question.id === questionId,
    );
    if (index !== -1) questions.value[index] = updated;
    return updated;
  }

  function removeQuestion(index) {
    if (typeof window === "undefined") {
      questions.value.splice(index, 1);
      return;
    }
    return removeQuestionOnServer(index);
  }

  async function removeQuestionOnServer(index) {
    const question = questions.value[index];
    const response = await apiFetch(
      `${API_BASE_URL}/questions/${question.id}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      throw new Error("删除题目失败");
    }

    questions.value.splice(index, 1);
  }

  function clearQuestions() {
    if (typeof window === "undefined") {
      const removedCount = questions.value.length;
      questions.value = [];
      return removedCount;
    }
    return clearQuestionsOnServer();
  }

  async function clearQuestionsOnServer() {
    const response = await apiFetch(`${API_BASE_URL}/questions`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("清空题库失败");
    }

    const result = await response.json();
    questions.value = [];
    return result.deletedCount;
  }

  function loadLocalQuestions() {
    const saved = localStorage.getItem("question-bank");
    let parsed;

    try {
      parsed = saved ? JSON.parse(saved) : [];
    } catch {
      parsed = [];
    }

    const storedQuestions = Array.isArray(parsed) ? parsed : [];
    const result = dedupeQuestionsByTitle(storedQuestions);
    questions.value = result.questions;

    if (result.duplicateCount > 0) {
      // 同步清理缓存，否则下次启动还会再次读到重复题。
      localStorage.setItem("question-bank", JSON.stringify(result.questions));
    }

    return result.duplicateCount;
  }

  async function loadQuestions(query = {}) {
    if (typeof window === "undefined") {
      return loadLocalQuestions();
    }

    loadController?.abort("superseded");
    const controller = new AbortController();
    loadController = controller;
    status.value = "loading";
    error.value = "";
    errorRequestId.value = "";
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "")
          params.set(key, String(value));
      }
      const suffix = params.toString() ? `?${params}` : "";
      const response = await apiFetch(`${API_BASE_URL}/questions${suffix}`, {
        signal: controller.signal,
        // 题库 Store 同时服务 Web 页面和 Electron 外壳；旧搜索由上方 controller 取消。
        cancelOnNavigation: false,
      });
      if (!response.ok) {
        throw new Error("获取题目失败");
      }
      const data = await response.json();
      questions.value = data;
      status.value = "success";
      return 0;
    } catch (caughtError) {
      if (
        caughtError?.code === "REQUEST_ABORTED" ||
        caughtError?.name === "AbortError"
      ) {
        // 只有当前请求能改状态；被替换的旧请求不能覆盖新请求的 loading/success。
        if (loadController === controller) {
          status.value = questions.value.length > 0 ? "success" : "idle";
        }
        return 0;
      }
      console.error(caughtError);
      recordClientError(caughtError, { feature: "questions.load" });
      status.value = "error";
      error.value = caughtError?.message || "获取题目失败";
      errorRequestId.value = caughtError?.requestId || "";
      return loadLocalQuestions();
    } finally {
      if (loadController === controller) loadController = null;
    }
  }
  loadQuestions();
  watch(
    questions,
    (value) => {
      localStorage.setItem("question-bank", JSON.stringify(value));
    },
    { deep: true },
  );

  return {
    questions,
    status,
    error,
    errorRequestId,
    addQuestion,
    addQuestions,
    importQuestions,
    updateQuestion,
    transitionStatus,
    removeQuestion,
    clearQuestions,
    loadQuestions,
  };
});
