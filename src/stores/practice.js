import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { API_BASE_URL } from "../config/api.js";
import { apiFetch } from "../utils/apiClient.js";
import { useAuthStore } from "./auth.js";
import { getNextReview } from "../utils/reviewSchedule.js";

const STORAGE_KEY = "practice-records";
const VALID_RESULTS = ["wrong", "partial", "correct"];
const VALID_MODES = ["write", "view"];

export const usePracticeStore = defineStore("practice", () => {
  const records = ref([]);
  const authStore = useAuthStore();
  let cloudRequestVersion = 0;

  function loadRecords() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      records.value = saved ? JSON.parse(saved) : [];
    } catch {
      records.value = [];
    }
  }
  function normalizeCloudRecord(record) {
    return {
      ...record,
      id: String(record.id),
      questionId: String(record.questionId),
      userAnswer: String(record.userAnswer ?? ""),
      mode: record.mode ?? "write",
      practicedAt: new Date(record.practicedAt).toISOString(),
      updatedAt: new Date(record.updatedAt ?? record.practicedAt).toISOString(),
    };
  }
  async function loadCloudRecords() {
    const userId = authStore.user?.id;
    if (!userId) return;
    const requestVersion = ++cloudRequestVersion;

    const response = await apiFetch(`${API_BASE_URL}/practice-records`, {
      // 这是登录会话级数据，不应因为页面切换而丢失；账号切换由下方版本号拦截旧响应。
      cancelOnNavigation: false,
    });
    const cloudRecords = await response.json();

    // 防止用户快速切换账号时，旧账号的响应覆盖新账号。
    if (authStore.user?.id !== userId || requestVersion !== cloudRequestVersion)
      return;

    records.value = Array.isArray(cloudRecords)
      ? cloudRecords.map(normalizeCloudRecord)
      : [];
  }

  function addRecord({
    questionId,
    clientRequestId,
    userAnswer,
    result,
    mode = "write",
  }) {
    if (!VALID_RESULTS.includes(result)) {
      throw new Error("Invalid practice result");
    }
    if (!VALID_MODES.includes(mode)) {
      throw new Error("Invalid practice mode");
    }

    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      clientRequestId: clientRequestId || crypto.randomUUID(),
      questionId: String(questionId),
      userAnswer: String(userAnswer || "").trim(),
      result,
      mode,
      practicedAt: now,
      updatedAt: now,
    };
    Object.assign(record, getNextReview({ ...record, result }, now));

    records.value.push(record);
    return record.id;
  }

  async function saveRecord(values) {
    if (!authStore.user) {
      const id = addRecord(values);
      return records.value.find((record) => record.id === id);
    }

    // 新写入优先于登录时尚未完成的旧列表请求。
    cloudRequestVersion += 1;

    const response = await apiFetch(`${API_BASE_URL}/practice-records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const cloudRecord = normalizeCloudRecord(await response.json());
    Object.assign(
      cloudRecord,
      getNextReview({ ...cloudRecord, result: values.result }),
    );
    const existingIndex = records.value.findIndex(
      (record) => record.clientRequestId === cloudRecord.clientRequestId,
    );

    // 重试同一次作答时用同一 clientRequestId，前端也只保留一份记录。
    if (existingIndex >= 0) records.value[existingIndex] = cloudRecord;
    else records.value.push(cloudRecord);
    return cloudRecord;
  }

  async function updateCloudRecord(id, values) {
    const response = await apiFetch(`${API_BASE_URL}/practice-records/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const cloudRecord = normalizeCloudRecord(await response.json());
    const index = records.value.findIndex((record) => record.id === String(id));
    if (index >= 0) records.value[index] = cloudRecord;
    return cloudRecord;
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

  watch(
    () => authStore.user?.id,
    (userId) => {
      if (userId) {
        records.value = [];
        void loadCloudRecords();
      } else {
        loadRecords();
      }
    },
    { immediate: true },
  );

  watch(
    records,
    (value) => {
      // 登录后以云端为准，不能把云端记录重新写回访客缓存。
      if (!authStore.user) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      }
    },
    { deep: true },
  );

  return {
    records,
    addRecord,
    saveRecord,
    updateRecord,
    updateCloudRecord,
    loadRecords,
    loadCloudRecords,
  };
});
