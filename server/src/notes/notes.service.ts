import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(currentUserId: number) {
    return this.prisma.note.findMany({
      where: { userId: currentUserId },
      include: { question: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(questionId: number, currentUserId: number) {
    const note = await this.prisma.note.findUnique({
      where: {
        userId_questionId: { userId: currentUserId, questionId },
      },
      include: { question: true },
    });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  async upsert(questionId: number, currentUserId: number, content: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return this.prisma.note.upsert({
      where: {
        userId_questionId: { userId: currentUserId, questionId },
      },
      update: { content: content.trim() },
      create: {
        userId: currentUserId,
        questionId,
        content: content.trim(),
      },
      include: { question: true },
    });
  }

  async remove(questionId: number, currentUserId: number) {
    const result = await this.prisma.note.deleteMany({
      where: { userId: currentUserId, questionId },
    });
    return { deleted: result.count === 1 };
  }
}
