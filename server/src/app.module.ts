import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QuestionsModule } from './questions/questions.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PracticeRecordsModule } from './practice-records/practice-records.module';
import { FavoritesModule } from './favorites/favorites.module';
import { NotesModule } from './notes/notes.module';
import { UploadsModule } from './uploads/uploads.module';
import { ImportJobsModule } from './import-jobs/import-jobs.module';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';
import { MetricsModule } from './observability/metrics.module';

@Module({
  imports: [
    QuestionsModule,
    PrismaModule,
    AuthModule,
    PracticeRecordsModule,
    FavoritesModule,
    NotesModule,
    UploadsModule,
    ImportJobsModule,
    UsersModule,
    MetricsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
