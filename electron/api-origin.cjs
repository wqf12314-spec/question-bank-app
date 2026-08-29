const DEFAULT_API_ORIGINS = Object.freeze([
  "http://localhost:3002",
  "https://question-bank-api-2vsg.onrender.com",
]);

function normalizeHttpOrigin(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`API origin 只允许 HTTP/HTTPS：${parsed.protocol}`);
  }
  return parsed.origin;
}

function createApiUrlValidator(extraOrigins = "") {
  const allowedOrigins = new Set(DEFAULT_API_ORIGINS);
  for (const value of String(extraOrigins).split(",")) {
    const trimmed = value.trim();
    if (trimmed) allowedOrigins.add(normalizeHttpOrigin(trimmed));
  }

  return function getApiUrl(url) {
    const parsed = new URL(url);
    if (!allowedOrigins.has(parsed.origin)) {
      throw new Error(`不允许访问该 API：${parsed.origin}`);
    }
    return parsed;
  };
}

module.exports = { DEFAULT_API_ORIGINS, createApiUrlValidator };
