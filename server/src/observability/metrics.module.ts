import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { ReadinessAlertService } from './readiness-alert.service';

@Global()
@Module({
  providers: [MetricsService, ReadinessAlertService],
  exports: [MetricsService, ReadinessAlertService],
})
export class MetricsModule {}
