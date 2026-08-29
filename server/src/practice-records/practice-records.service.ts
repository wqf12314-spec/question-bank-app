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

    // 使用数据库原生 ON CONFLICT DO NOTHING，避免并发重放先抛 P2002 再等待提交可见。
    await this.prisma.practiceRecord.createMany({
      data: createData,
      skipDuplicates: true,
    });

    const where = {
      userId_clientRequestId: {
        userId: currentUserId,
        clientRequestId: data.clientRequestId,
      },
    };
    // 冲突事务提交与读取可见之间可能有短暂窗口，使用上限 2 秒的指数退避。
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const existing = await this.prisma.practiceRecord.findUnique({ where });
      if (existing) return existing;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, 5 * 2 ** Math.min(attempt, 5))),
      );
    }
    return this.prisma.practiceRecord.findUniqueOrThrow({ where });
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
