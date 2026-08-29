import { readFile } from "node:fs/promises";

const report = JSON.parse(
  await readFile(
    new URL("../docs/evidence/upload-performance-report.json", import.meta.url),
    "utf8",
  ),
);
const samples = (report.concurrencyRuns || [])
  .map((value) => Number(value.durationMs))
  .filter(Number.isFinite);
if (samples.length === 0) throw new Error("missing benchmark baseline");
const p95 = [...samples].sort((a, b) => a - b)[
  Math.ceil(samples.length * 0.95) - 1
];
const threshold = Math.ceil(p95 * 2);
console.log(JSON.stringify({ samples, p95, alertThresholdMs: threshold }));
