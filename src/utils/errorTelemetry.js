const STORAGE_KEY = "knowledge-navigator-error-events";
const ENABLED_KEY = "knowledge-navigator-telemetry-enabled";
import { sanitizeTelemetryMetadata } from "./telemetrySanitizer.js";

export function isTelemetryEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "true";
}

export function setTelemetryEnabled(enabled) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
}

export function recordClientError(error, context = {}) {
  if (typeof localStorage === "undefined" || !isTelemetryEnabled()) return;
  const event = {
    message:
      typeof error?.message === "string" ? error.message : "Unknown error",
    code: typeof error?.code === "string" ? error.code : "CLIENT_ERROR",
    requestId:
      typeof error?.requestId === "string" ? error.requestId : undefined,
    route: typeof location === "undefined" ? "unknown" : location.pathname,
    version:
      import.meta.env?.VITE_APP_RELEASE || import.meta.env?.MODE || "dev",
    context: sanitizeTelemetryMetadata(context),
    occurredAt: new Date().toISOString(),
  };
  let events;
  try {
    events = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    events = [];
  }
  events.push(event);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-50)));
}

export function readClientErrors() {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
