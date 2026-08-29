import { API_BASE_URL } from "../config/api.js";
import { apiFetch, getAccessToken } from "./apiClient.js";

export function splitFile(file, partSize) {
  if (!file || typeof file.slice !== "function") {
    throw new TypeError("file must be a Blob");
  }
  if (!Number.isInteger(partSize) || partSize < 1) {
    throw new RangeError("partSize must be a positive integer");
  }

  const parts = [];
  for (let offset = 0; offset < file.size; offset += partSize) {
    parts.push(file.slice(offset, Math.min(offset + partSize, file.size)));
  }
  return parts;
}

export async function sha256Blob(blob, { onProgress } = {}) {
  if (typeof Worker !== "undefined" && typeof window !== "undefined") {
    const worker = new Worker(
      new URL("../workers/sha256.worker.js", import.meta.url),
      {
        type: "module",
      },
    );
    return new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") onProgress?.(data.completed / data.total);
        if (data.type === "done") {
          worker.terminate();
          resolve(data.digest);
        }
      };
      worker.onerror = (error) => {
        worker.terminate();
        reject(error);
      };
      worker.postMessage({ file: blob, chunkSize: 8 * 1024 * 1024 });
    });
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function classifyUploadError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return "transient";
  if ([401, 403, 413, 415, 422].includes(status)) return "permanent";
  if (error?.name === "AbortError" || error?.code === "REQUEST_ABORTED")
    return "cancelled";
  return status === 0 ? "transient" : "permanent";
}

export async function withUploadRetry(
  task,
  { retries = 2, signal, delayMs = 250, onRetry } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted)
      throw signal.reason || new DOMException("Aborted", "AbortError");
    try {
      return await task({ signal, attempt });
    } catch (error) {
      if (classifyUploadError(error) !== "transient" || attempt >= retries)
        throw error;
      const waitMs =
        delayMs * 2 ** attempt + Math.floor(Math.random() * delayMs);
      onRetry?.(attempt + 1, waitMs);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
  }
}

const progressMemory = new Map();

export async function saveUploadProgress(key, value) {
  if (typeof indexedDB === "undefined") {
    progressMemory.set(key, structuredClone(value));
    return;
  }
  const database = await openProgressDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("uploads", "readwrite");
    transaction.objectStore("uploads").put({ key, value });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadUploadProgress(key) {
  if (typeof indexedDB === "undefined") return progressMemory.get(key) || null;
  const database = await openProgressDb();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("uploads")
      .objectStore("uploads")
      .get(key);
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}

export async function removeUploadProgress(key) {
  if (typeof indexedDB === "undefined") {
    progressMemory.delete(key);
    return;
  }
  const database = await openProgressDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("uploads", "readwrite");
    transaction.objectStore("uploads").delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function openProgressDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("knowledge-navigator-uploads", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("uploads", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function runWithConcurrency(tasks, limit, { signal } = {}) {
  if (!Array.isArray(tasks)) throw new TypeError("tasks must be an array");
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("limit must be a positive integer");
  }

  const results = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length && !signal?.aborted) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}

export async function uploadFile(
  file,
  {
    apiBaseUrl = API_BASE_URL,
    concurrency = 4,
    signal,
    onProgress,
    transport = createUploadTransport({ apiBaseUrl }),
  } = {},
) {
  const fileKey = `upload:${file.name || "blob"}:${file.size}:${file.lastModified || 0}`;
  onProgress?.({ stage: "hashing", completedBytes: 0, totalBytes: file.size });
  const sha256 = await sha256Blob(file, {
    onProgress: (ratio) =>
      onProgress?.({
        stage: "hashing",
        completedBytes: Math.round(file.size * ratio),
        totalBytes: file.size,
      }),
  });

  let saved = await loadUploadProgress(fileKey);
  // 文件名相同不代表内容相同，只有指纹一致才能恢复旧会话。
  if (saved?.sha256 && saved.sha256 !== sha256) saved = null;
  let sessionId = saved?.sessionId;
  let partSize = saved?.partSize;
  let uploadedParts = new Set(saved?.uploadedParts || []);
  if (sessionId) {
    try {
      const statusResponse = await apiFetch(
        `${apiBaseUrl}/uploads/${sessionId}`,
        { signal },
      );
      const status = await statusResponse.json();
      partSize = status.partSize;
      uploadedParts = new Set(
        status.uploadedParts.map((part) => part.partNumber),
      );
    } catch {
      sessionId = null;
      uploadedParts = new Set();
    }
  }
  if (!sessionId) {
    const response = await apiFetch(`${apiBaseUrl}/uploads/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name || "upload.bin",
        size: file.size,
        mime: file.type || "application/octet-stream",
        sha256,
      }),
      signal,
    });
    const initiated = await response.json();
    if (initiated.fileObjectId) {
      await removeUploadProgress(fileKey);
      onProgress?.({
        stage: "verifying",
        completedBytes: file.size,
        totalBytes: file.size,
      });
      onProgress?.({
        stage: "done",
        completedBytes: file.size,
        totalBytes: file.size,
      });
      return {
        id: initiated.fileObjectId,
        fileObjectId: initiated.fileObjectId,
        deduplicated: true,
      };
    }
    sessionId = initiated.sessionId;
    partSize = initiated.partSize;
    await saveUploadProgress(fileKey, {
      sessionId,
      partSize,
      sha256,
      uploadedParts: [],
    });
  }

  const parts = splitFile(file, partSize);
  let uploadedBytes = parts.reduce(
    (total, part, index) =>
      uploadedParts.has(index + 1) ? total + part.size : total,
    0,
  );
  onProgress?.({
    stage: "uploading",
    completedBytes: uploadedBytes,
    totalBytes: file.size,
  });
  const activePartBytes = new Map();
  const emitByteProgress = () => {
    const inFlightBytes = [...activePartBytes.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    onProgress?.({
      stage: "uploading",
      completedBytes: uploadedBytes + inFlightBytes,
      totalBytes: file.size,
    });
  };
  await runWithConcurrency(
    parts.map((part, index) => async () => {
      const partNumber = index + 1;
      if (uploadedParts.has(partNumber)) return;
      await withUploadRetry(
        async ({ signal: retrySignal }) => {
          activePartBytes.set(partNumber, 0);
          await transport.uploadPart(sessionId, partNumber, part, {
            signal: retrySignal,
            onProgress: (bytes) => {
              activePartBytes.set(partNumber, bytes);
              emitByteProgress();
            },
          });
          activePartBytes.delete(partNumber);
        },
        { signal, retries: 2 },
      );
      uploadedParts.add(partNumber);
      uploadedBytes += part.size;
      activePartBytes.delete(partNumber);
      await saveUploadProgress(fileKey, {
        sessionId,
        partSize,
        sha256,
        uploadedParts: [...uploadedParts].sort((a, b) => a - b),
      });
      onProgress?.({
        stage: "uploading",
        completedBytes: uploadedBytes,
        totalBytes: file.size,
      });
    }),
    concurrency,
    { signal },
  );

  onProgress?.({
    stage: "verifying",
    completedBytes: file.size,
    totalBytes: file.size,
  });
  const completedResponse = await apiFetch(
    `${apiBaseUrl}/uploads/${sessionId}/complete`,
    {
      method: "POST",
      signal,
    },
  );
  const completed = await completedResponse.json();
  await removeUploadProgress(fileKey);
  onProgress?.({
    stage: "done",
    completedBytes: file.size,
    totalBytes: file.size,
  });
  return completed;
}

/**
 * 上传业务只依赖这一个小 Transport 契约，Web/Electron 的传输差异留在适配器中。
 * Web 需要 XHR 的 upload.onprogress；Electron 通过受限 IPC 由主进程流式发送并回报字节。
 */
export function createUploadTransport({ apiBaseUrl = API_BASE_URL } = {}) {
  const useDesktopIpc =
    typeof window !== "undefined" &&
    typeof window.desktopAPI?.upload?.part === "function";
  const useXhr =
    typeof window !== "undefined" &&
    typeof XMLHttpRequest !== "undefined" &&
    !window.desktopAPI?.isDesktop;
  return {
    kind: useDesktopIpc ? "electron-ipc" : useXhr ? "xhr" : "api",
    uploadPart(sessionId, partNumber, body, options = {}) {
      const url = `${apiBaseUrl}/uploads/${sessionId}/parts/${partNumber}`;
      if (useDesktopIpc) return uploadPartWithDesktopIpc(url, body, options);
      if (useXhr) return uploadPartWithXhr(url, body, options);
      return apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body,
        signal: options.signal,
      }).then((response) => response.json());
    },
  };
}

async function uploadPartWithDesktopIpc(
  url,
  body,
  { signal, onProgress } = {},
) {
  if (signal?.aborted) {
    throw signal.reason || new DOMException("Aborted", "AbortError");
  }

  const requestId = crypto.randomUUID();
  const token = getAccessToken();
  const abort = () => window.desktopAPI.upload.abort(requestId);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await window.desktopAPI.upload.part(
      {
        requestId,
        url,
        headers: {
          "Content-Type": "application/octet-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: await body.arrayBuffer(),
      },
      onProgress,
    );
    if (!result.ok) {
      const error = new Error(`Upload part failed: ${result.status}`);
      error.status = result.status;
      throw error;
    }
    const payload = JSON.parse(result.body || "{}");
    return payload?.success === true ? payload.data : payload;
  } catch (error) {
    if (signal?.aborted) {
      const cancelled = new Error("Upload part was cancelled");
      cancelled.code = "REQUEST_ABORTED";
      throw cancelled;
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function uploadPartWithXhr(url, body, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      xhr.abort();
      if (!settled)
        reject(signal?.reason || new DOMException("Aborted", "AbortError"));
    };
    xhr.open("POST", url);
    xhr.withCredentials = true;
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded);
    };
    xhr.onload = () => {
      settled = true;
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText || "{}"));
        } catch {
          resolve({});
        }
        return;
      }
      const error = new Error(`Upload part failed: ${xhr.status}`);
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => {
      settled = true;
      cleanup();
      const error = new Error("Network error while uploading part");
      error.status = 0;
      reject(error);
    };
    xhr.onabort = () => {
      if (!settled)
        reject(signal?.reason || new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    xhr.send(body);
  });
}
