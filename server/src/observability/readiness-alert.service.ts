import { Injectable } from '@nestjs/common';
import pino from 'pino';

export type ReadinessAlert = {
  dependency: 'postgres' | 'redis' | 'objectStorage';
  occurredAt: string;
  message: string;
};

/** 本地运行时保留可检查的依赖故障记录；线上可将同一结构接到告警平台。 */
@Injectable()
export class ReadinessAlertService {
  private readonly logger = pino({ name: 'question-bank-readiness-alert' });
  private readonly alerts: ReadinessAlert[] = [];

  record(dependency: ReadinessAlert['dependency'], error: unknown) {
    const alert = {
      dependency,
      occurredAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    };
    this.alerts.push(alert);
    if (this.alerts.length > 100) this.alerts.shift();
    this.logger.error(alert, 'readiness dependency alert');
    return alert;
  }

  snapshot() {
    return [...this.alerts];
  }
}
