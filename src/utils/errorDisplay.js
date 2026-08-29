export function getErrorDetails(error, fallback = "请求失败") {
  const message =
    typeof error?.message === "string" && error.message
      ? error.message
      : fallback;
  const requestId =
    typeof error?.requestId === "string" && error.requestId
      ? error.requestId
      : "";
  return { message, requestId };
}

export function formatErrorMessage(error, fallback = "请求失败") {
  const details = getErrorDetails(error, fallback);
  return details.requestId
    ? `${details.message}（请求 ID：${details.requestId}）`
    : details.message;
}
