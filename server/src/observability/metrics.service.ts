import { Injectable } from '@nestjs/common';

type RequestSample = { status: number; durationMs: number };

@Injectable()
export class MetricsService {
  private readonly requests: RequestSample[] = [];
  private importJobCount = 0;
  private importJobFailures = 0;
  private readonly importDurations: number[] = [];
  private queueDepth = 0;
  private syncConflictCount = 0;

  recordRequest(status: number, durationMs: number) {
    this.requests.push({ status, durationMs });
    if (this.requests.length > 1000) this.requests.shift();
    if (status === 409) this.syncConflictCount += 1;
  }

  recordImportJob(status: string, durationMs?: number) {
    this.importJobCount += 1;
    if (['FAILED', 'PARTIAL'].includes(status)) this.importJobFailures += 1;
    if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
      this.importDurations.push(durationMs);
      if (this.importDurations.length > 1000) this.importDurations.shift();
    }
  }

  setQueueDepth(depth: number) {
    this.queueDepth = Math.max(0, Math.trunc(depth));
  }

  snapshot() {
    const durations = this.requests
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
    const importDurations = [...this.importDurations].sort((a, b) => a - b);
    return {
      requests: {
        total: this.requests.length,
        fiveXX: this.requests.filter((sample) => sample.status >= 500).length,
        p95DurationMs: this.percentile(durations, 0.95),
      },
      importJobs: {
        completed: this.importJobCount,
        failures: this.importJobFailures,
        failureRate: this.importJobCount
          ? Number((this.importJobFailures / this.importJobCount).toFixed(4))
          : 0,
        p95DurationMs: this.percentile(importDurations, 0.95),
      },
      queueDepth: this.queueDepth,
      syncConflictCount: this.syncConflictCount,
      note: '进程内采样；多实例和长期历史请接 Prometheus/集中式指标存储。',
    };
  }

  private percentile(values: number[], ratio: number) {
    if (values.length === 0) return 0;
    return values[
      Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)
    ];
  }
}
