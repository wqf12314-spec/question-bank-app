import { defineStore } from "pinia";
import { ref, watch } from "vue";

export const useQuestionsStore = defineStore("questions", () => {
  const questions = ref([]);

  function addQuestion(question) {
    questions.value.push(question);
  }

  function addQuestions(nextQuestions) {
    questions.value.push(...nextQuestions);
  }

  function updateQuestion(index, nextQuestion) {
    questions.value[index] = nextQuestion;
  }

  function removeQuestion(index) {
    questions.value.splice(index, 1);
  }

  function loadQuestions() {
    const saved = localStorage.getItem("question-bank");
    questions.value = saved ? JSON.parse(saved) : [];
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
    loadQuestions,
  };
});
