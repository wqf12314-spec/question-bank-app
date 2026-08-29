import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(currentUserId: number) {
    return this.prisma.favorite.findMany({
      where: { userId: currentUserId },
      include: { question: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async add(questionId: number, currentUserId: number) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // upsert + 联合唯一键让重复点击和并发请求都保持幂等。
    return this.prisma.favorite.upsert({
      where: {
        userId_questionId: { userId: currentUserId, questionId },
      },
      update: {},
      create: { userId: currentUserId, questionId },
      include: { question: true },
    });
  }

  async remove(questionId: number, currentUserId: number) {
    const result = await this.prisma.favorite.deleteMany({
      where: { userId: currentUserId, questionId },
    });
    return { deleted: result.count === 1 };
  }
}
