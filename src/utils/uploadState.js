export const UPLOAD_STATES = Object.freeze([
  "idle",
  "hashing",
  "uploading",
  "paused",
  "verifying",
  "processing",
  "done",
  "failed",
  "cancelled",
]);

const transitions = {
  idle: ["hashing", "cancelled"],
  // 命中同用户已验证文件时跳过分片上传，直接进入服务端确认阶段。
  hashing: ["uploading", "verifying", "failed", "cancelled", "paused"],
  uploading: ["paused", "verifying", "failed", "cancelled"],
  paused: ["hashing", "uploading", "cancelled"],
  verifying: ["processing", "done", "failed", "cancelled"],
  processing: ["done", "failed", "cancelled"],
  // 文件传输完成后还可以继续进入异步导入，最终再回到 done。
  done: ["idle", "hashing", "processing"],
  // 上传失败从 hashing 重试；导入失败则直接回到 processing 重跑任务。
  failed: ["idle", "hashing", "processing", "cancelled"],
  cancelled: ["idle", "hashing"],
};

export function canTransitionUploadState(current, next) {
  return current === next || transitions[current]?.includes(next) === true;
}

export function transitionUploadState(current, next) {
  if (
    !UPLOAD_STATES.includes(next) ||
    !canTransitionUploadState(current, next)
  ) {
    throw new Error(`Invalid upload state transition: ${current} -> ${next}`);
  }
  return next;
}
