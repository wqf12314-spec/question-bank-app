import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PracticeRecordsController } from './practice-records.controller';
import { PracticeRecordsService } from './practice-records.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PracticeRecordsController],
  providers: [PracticeRecordsService],
})
export class PracticeRecordsModule {}
