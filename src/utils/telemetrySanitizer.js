const SENSITIVE_KEY =
  /(answer|content|body|password|token|authorization|cookie|secret)/i;

export function sanitizeTelemetryMetadata(value, depth = 0) {
  if (depth > 4) return "[depth-limited]";
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeTelemetryMetadata(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, item]) => [
          key,
          sanitizeTelemetryMetadata(item, depth + 1),
        ]),
    );
  }
  if (typeof value === "string") return value.slice(0, 500);
  if (["number", "boolean"].includes(typeof value) || value == null) {
    return value;
  }
  return String(value).slice(0, 500);
}
