import { Module } from '@nestjs/common';
import { ImportJobsModule } from './import-jobs.module';
import { ImportWorkerService } from './import-worker.service';

@Module({
  imports: [ImportJobsModule],
  providers: [ImportWorkerService],
})
export class WorkerModule {}
