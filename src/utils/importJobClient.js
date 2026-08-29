import { API_BASE_URL } from "../config/api.js";
import { apiFetch } from "./apiClient.js";

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  const event = { data: "" };
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value =
      separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "id") event.id = value;
    if (field === "event") event.event = value;
    if (field === "data") event.data += `${event.data ? "\n" : ""}${value}`;
  }
  if (!event.event && !event.data && !event.id) return null;
  try {
    event.data = event.data ? JSON.parse(event.data) : null;
  } catch {
    /* 保留原始数据供错误报告 */
  }
  return event;
}

export function parseSseText(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map(parseSseBlock)
    .filter(Boolean);
}

export async function createImportJob(
  fileObjectId,
  { pipelineVersion = "v1", idempotencyKey, signal } = {},
) {
  const response = await apiFetch(`${API_BASE_URL}/import-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileObjectId,
      pipelineVersion,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
    signal,
  });
  return response.json();
}

export async function cancelImportJob(jobId) {
  return postJobAction(jobId, "cancel");
}

export async function retryImportJob(jobId) {
  return postJobAction(jobId, "retry");
}

export async function getImportReview(jobId) {
  const response = await apiFetch(
    `${API_BASE_URL}/import-jobs/${jobId}/review`,
  );
  return response.json();
}

export async function publishImportReview(jobId) {
  return postJobAction(jobId, "publish");
}

export async function rollbackImportReview(jobId) {
  return postJobAction(jobId, "rollback");
}

export function createReviewQuestionPayload(question, { reason } = {}) {
  return {
    title: question.title,
    answer: question.answer,
    category: question.category,
    tags: question.tags,
    difficulty: question.difficulty,
    version: question.version,
    ...(reason ? { reason } : {}),
  };
}

export async function saveReviewQuestion(question, options) {
  const response = await apiFetch(`${API_BASE_URL}/questions/${question.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createReviewQuestionPayload(question, options)),
  });
  return response.json();
}

async function postJobAction(jobId, action) {
  const response = await apiFetch(
    `${API_BASE_URL}/import-jobs/${jobId}/${action}`,
    {
      method: "POST",
    },
  );
  return response.json();
}

export async function readImportJobEvents(
  jobId,
  lastEventId = 0,
  { signal } = {},
) {
  const headers = {
    Accept: "text/event-stream",
    ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
  };
  const response = await apiFetch(
    `${API_BASE_URL}/import-jobs/${jobId}/events`,
    {
      headers,
      signal,
    },
  );
  return parseSseText(await response.text());
}

export function watchImportJob(
  jobId,
  { onEvent, onError, signal, intervalMs = 800 } = {},
) {
  let lastEventId = 0;
  let stopped = false;
  let timer;
  async function poll() {
    if (stopped || signal?.aborted) return;
    try {
      const events = await readImportJobEvents(jobId, lastEventId, { signal });
      for (const event of events) {
        if (event.id)
          lastEventId = Math.max(lastEventId, Number(event.id) || 0);
        onEvent?.(event);
      }
      const latest = [...events].reverse().find((event) => event.data?.status);
      if (
        latest &&
        [
          "WAITING_REVIEW",
          "SUCCEEDED",
          "PARTIAL",
          "FAILED",
          "CANCELLED",
        ].includes(latest.data.status)
      )
        return;
      timer = setTimeout(poll, intervalMs);
    } catch (error) {
      if (!stopped && !signal?.aborted) {
        onError?.(error);
        timer = setTimeout(poll, Math.min(intervalMs * 2, 5000));
      }
    }
  }
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
