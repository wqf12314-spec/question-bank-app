import { defineStore } from "pinia";
import { ref, watch } from "vue";
import {
  dedupeQuestionsByTitle,
  filterNewQuestions,
} from "../utils/questionTransfer.js";

export const useQuestionsStore = defineStore("questions", () => {
  const questions = ref([]);

  function addQuestion(question) {
    return addQuestions([question]);
  }

  function addQuestions(nextQuestions) {
    const result = filterNewQuestions(questions.value, nextQuestions);
    questions.value.push(...result.questions);

    return {
      addedCount: result.questions.length,
      duplicateCount: result.duplicateCount,
    };
  }

  function updateQuestion(index, nextQuestion) {
    questions.value[index] = nextQuestion;
  }

  function removeQuestion(index) {
    questions.value.splice(index, 1);
  }

  function clearQuestions() {
    const removedCount = questions.value.length;
    questions.value = [];
    return removedCount;
  }

  function loadQuestions() {
    const saved = localStorage.getItem("question-bank");
    const parsed = saved ? JSON.parse(saved) : [];
    const storedQuestions = Array.isArray(parsed) ? parsed : [];
    const result = dedupeQuestionsByTitle(storedQuestions);

    questions.value = result.questions;

    if (result.duplicateCount > 0) {
      localStorage.setItem("question-bank", JSON.stringify(result.questions));
    }

    return result.duplicateCount;
  }

  loadQuestions();

  watch(
    questions,
    (value) => {
      localStorage.setItem("question-bank", JSON.stringify(value));
    },
    { deep: true }
  );

  return {
    questions,
    addQuestion,
    addQuestions,
    updateQuestion,
    removeQuestion,
    clearQuestions,
    loadQuestions,
  };
});
