import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const questions = await this.prisma.question.findMany({
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
      throw new NotFoundException(`Question ${id} not found`);
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
        difficulty: question.difficulty ?? '基础',
        tags: JSON.stringify(question.tags ?? []),
      })),
    });

    return {
      importedCount: result.count,
      skippedCount: questions.length - result.count,
    };
  }

  async update(id: number, data: {
    title: string;
    category: string;
    answer?: string;
    difficulty?: string;
    tags?: string[];
  }) {
    await this.findOne(id);

    const question = await this.prisma.question.update({
      where: { id },
      data: {
        title: data.title.trim(),
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
