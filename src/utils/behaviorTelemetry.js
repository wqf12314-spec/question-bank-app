const STORAGE_KEY = "knowledge-navigator-behavior-events";
import { isTelemetryEnabled } from "./errorTelemetry.js";
import { sanitizeTelemetryMetadata } from "./telemetrySanitizer.js";

export function trackBehavior(name, metadata = {}) {
  if (typeof localStorage === "undefined" || !isTelemetryEnabled()) return;
  let events;
  try {
    events = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    events = [];
  }
  events.push({
    name,
    metadata: sanitizeTelemetryMetadata(metadata),
    occurredAt: new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-200)));
}

export function readBehaviorEvents() {
  if (typeof localStorage === "undefined") return [];
  try {
    const events = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}
