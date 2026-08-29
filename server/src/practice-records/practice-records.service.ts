import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';

@Injectable()
export class PracticeRecordsService {
  constructor(private readonly prisma: PrismaService) {}
  async createIdempotent(currentUserId: number, data: CreatePracticeRecordDto) {
    const createData = {
      userId: currentUserId,
      clientRequestId: data.clientRequestId,
      questionId: data.questionId,
      userAnswer: data.userAnswer?.trim() ?? '',
      result: data.result,
      mode: data.mode ?? 'write',
      practicedAt: data.practicedAt ? new Date(data.practicedAt) : undefined,
    };

    try {
      return await this.prisma.practiceRecord.create({
        data: createData,
      });
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      // 唯一键冲突可能先于对方事务提交可见，有限退避后再读，避免幂等请求误报 500。
      const where = {
        userId_clientRequestId: {
          userId: currentUserId,
          clientRequestId: data.clientRequestId,
        },
      };
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const existing = await this.prisma.practiceRecord.findUnique({ where });
        if (existing) return existing;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return this.prisma.practiceRecord.findUniqueOrThrow({ where });
    }
  }

  async getSummary(currentUserId: number) {
    const [practiceRecordCount, latestRecord] = await Promise.all([
      this.prisma.practiceRecord.count({
        where: { userId: currentUserId },
      }),
      this.prisma.practiceRecord.findFirst({
        where: { userId: currentUserId },
        orderBy: { practicedAt: 'desc' },
        select: { practicedAt: true },
      }),
    ]);

    return {
      practiceRecordCount,
      latestPracticedAt: latestRecord?.practicedAt ?? null,
    };
  }
  async findAllOwned(currentUserId: number) {
    return this.prisma.practiceRecord.findMany({
      where: { userId: currentUserId },
      orderBy: { practicedAt: 'desc' },
    });
  }
  async findOwned(recordId: number, currentUserId: number) {
    const record = await this.prisma.practiceRecord.findFirst({
      where: {
        id: recordId,
        userId: currentUserId,
      },
    });

    if (!record) {
      throw new NotFoundException('Practice record not found');
    }

    return record;
  }
  async updateOwned(
    recordId: number,
    currentUserId: number,
    data: {
      userAnswer?: string;
      result: string;
      mode?: string;
    },
  ) {
    const result = await this.prisma.practiceRecord.updateMany({
      where: {
        id: recordId,
        userId: currentUserId,
      },
      data: {
        userAnswer: data.userAnswer ?? '',
        result: data.result,
        mode: data.mode ?? 'write',
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Practice record not found');
    }

    return this.findOwned(recordId, currentUserId);
  }
  async removeOwned(recordId: number, currentUserId: number) {
    const result = await this.prisma.practiceRecord.deleteMany({
      where: {
        id: recordId,
        userId: currentUserId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Practice record not found');
    }

    return { deleted: true };
  }
}
