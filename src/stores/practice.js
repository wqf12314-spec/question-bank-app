import { defineStore } from "pinia";
import { ref, watch } from "vue";

const STORAGE_KEY = "practice-records";
const VALID_RESULTS = ["wrong", "partial", "correct"];
const VALID_MODES = ["write", "view"];

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

  function addRecord({ questionId, userAnswer, result, mode = "write" }) {
    if (!VALID_RESULTS.includes(result)) {
      throw new Error("Invalid practice result");
    }
    if (!VALID_MODES.includes(mode)) {
      throw new Error("Invalid practice mode");
    }

    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      questionId: String(questionId),
      userAnswer: String(userAnswer || "").trim(),
      result,
      mode,
      practicedAt: now,
      updatedAt: now,
    };

    records.value.push(record);
    return record.id;
  }

  function updateRecord(id, { userAnswer, result, mode }) {
    if (!VALID_RESULTS.includes(result)) {
      throw new Error("Invalid practice result");
    }
    if (mode !== undefined && !VALID_MODES.includes(mode)) {
      throw new Error("Invalid practice mode");
    }

    const record = records.value.find((item) => item.id === id);
    if (!record) return false;

    record.userAnswer = String(userAnswer || "").trim();
    record.result = result;
    record.mode = mode || record.mode || "write";
    record.updatedAt = new Date().toISOString();
    return true;
  }

  loadRecords();

  watch(
    records,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    },
    { deep: true }
  );

  return {
    records,
    addRecord,
    updateRecord,
    loadRecords,
  };
});
