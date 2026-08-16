// 部署时读取线上后端地址；本地没配置时继续使用本机后端。
const API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.desktopAPI?.isDesktop
    ? "https://question-bank-api-2vsg.onrender.com"
    : "http://localhost:3002");

import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { apiFetch } from "../utils/apiClient.js";
import {
  dedupeQuestionsByTitle,
  filterNewQuestions,
} from "../utils/questionTransfer.js";

export const useQuestionsStore = defineStore("questions", () => {
  const questions = ref([]);

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

  function removeQuestion(index) {
    if (typeof window === "undefined") {
      questions.value.splice(index, 1);
      return;
    }
    return removeQuestionOnServer(index);
  }

  async function removeQuestionOnServer(index) {
    const question = questions.value[index];
    const response = await apiFetch(`${API_BASE_URL}/questions/${question.id}`, {
      method: "DELETE",
    });

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
    let parsed = [];

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

  async function loadQuestions() {
    if (typeof window === "undefined") {
      return loadLocalQuestions();
    }

    try {
      const response = await apiFetch(`${API_BASE_URL}/questions`);
      if (!response.ok) {
        throw new Error("获取题目失败");
      }
      const data = await response.json();
      questions.value = data;
      return 0;
    } catch (error) {
      console.error(error);
      return loadLocalQuestions();
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
    addQuestion,
    addQuestions,
    importQuestions,
    updateQuestion,
    removeQuestion,
    clearQuestions,
    loadQuestions,
  };
});
