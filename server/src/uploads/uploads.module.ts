import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadsController } from './uploads.controller';
import { ObjectStorageService } from './object-storage.service';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UploadsController],
  providers: [ObjectStorageService, UploadsService],
  exports: [ObjectStorageService],
})
export class UploadsModule {}
