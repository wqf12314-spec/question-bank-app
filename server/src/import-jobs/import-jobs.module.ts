import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QuestionsModule } from '../questions/questions.module';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';
import { ImportQueueService } from './import-queue.service';
import { MetricsModule } from '../observability/metrics.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DocumentExtractionService } from './document-extraction.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    QuestionsModule,
    MetricsModule,
    UploadsModule,
  ],
  controllers: [ImportJobsController],
  providers: [ImportJobsService, ImportQueueService, DocumentExtractionService],
  exports: [ImportJobsService, ImportQueueService],
})
export class ImportJobsModule {}
