import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FindQuestionsDto } from './dto/find-questions.dto';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindQuestionsDto) {
    const hasPagination =
      query.page !== undefined || query.pageSize !== undefined;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const questions = await this.prisma.question.findMany({
      where: {
        ...(query.keyword
          ? {
              OR: [
                { title: { contains: query.keyword, mode: 'insensitive' } },
                { answer: { contains: query.keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.tag
          ? {
              tags: {
                contains: `"${query.tag}"`,
              },
            }
          : {}),
      },

      ...(hasPagination ? { skip, take: pageSize } : {}),
      orderBy: { id: 'asc' },
    });

    return questions.map((question) => this.toResponse(question));
  }

  async getCount() {
    return this.prisma.question.count();
  }

  async findOne(id: number) {
    const question = await this.prisma.question.findUnique({
      where: { id },
    });

    if (!question) {
      throw new NotFoundException({
        // 稳定错误码供前端判断，message 只负责展示和排查。
        success: false,
        error: {
          code: 'QUESTION_NOT_FOUND',
          message: `Question ${id} not found`,
        },
      });
    }

    return this.toResponse(question);
  }

  async create(data: {
    title: string;
    category: string;
    answer?: string;
    difficulty?: string;
    tags?: string[];
  }) {
    const question = await this.prisma.question.create({
      data: {
        title: data.title.trim(),
        normalizedTitle: this.normalizeTitle(data.title),
        category: data.category,
        answer: data.answer ?? '',
        difficulty: data.difficulty ?? '基础',
        tags: JSON.stringify(data.tags ?? []),
      },
    });

    return this.toResponse(question);
  }

  async importMany(
    questions: Array<{
      title: string;
      category: string;
      answer?: string;
      difficulty?: string;
      tags?: string[];
    }>,
  ) {
    const existingQuestions = await this.prisma.question.findMany({
      select: { title: true },
    });
    const seenTitles = new Set(
      existingQuestions.map((question) => this.normalizeTitle(question.title)),
    );
    const uniqueQuestions = questions.filter((question) => {
      const normalizedTitle = this.normalizeTitle(question.title);
      if (seenTitles.has(normalizedTitle)) {
        return false;
      }
      seenTitles.add(normalizedTitle);
      return true;
    });

    const result = await this.prisma.question.createMany({
      data: uniqueQuestions.map((question) => ({
        title: question.title.trim(),
        category: question.category,
        answer: question.answer ?? '',
        normalizedTitle: this.normalizeTitle(question.title),
        difficulty: question.difficulty ?? '基础',
        tags: JSON.stringify(question.tags ?? []),
      })),
      // 由数据库唯一索引原子处理并发冲突，避免先查后写的竞态。
      skipDuplicates: true,
    });

    return {
      importedCount: result.count,
      skippedCount: questions.length - result.count,
    };
  }

  async update(
    id: number,
    data: {
      title: string;
      category: string;
      answer?: string;
      difficulty?: string;
      tags?: string[];
    },
  ) {
    await this.findOne(id);

    const question = await this.prisma.question.update({
      where: { id },
      data: {
        title: data.title.trim(),
        normalizedTitle: this.normalizeTitle(data.title),
        category: data.category,
        answer: data.answer ?? '',
        difficulty: data.difficulty ?? '基础',
        tags: JSON.stringify(data.tags ?? []),
      },
    });

    return this.toResponse(question);
  }

  async remove(id: number) {
    await this.findOne(id);

    const question = await this.prisma.question.delete({
      where: { id },
    });

    return this.toResponse(question);
  }

  async clear() {
    const result = await this.prisma.question.deleteMany();
    return { deletedCount: result.count };
  }

  private normalizeTitle(title: string) {
    return title.trim().toLocaleLowerCase();
  }

  private toResponse<T extends { tags: string }>(question: T) {
    return {
      ...question,
      tags: JSON.parse(question.tags) as string[],
    };
  }
}
