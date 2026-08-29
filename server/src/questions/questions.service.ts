import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
        ...(query.status ? { status: query.status as any } : {}),
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

  async listRevisions(id: number) {
    await this.findOne(id);
    return this.prisma.questionRevision.findMany({
      where: { questionId: id },
      orderBy: { createdAt: 'desc' },
      include: { editor: { select: { id: true, email: true, role: true } } },
    });
  }

  async transitionStatus(
    id: number,
    status: string,
    actorId: number,
    actorRole: string,
  ) {
    const current = await this.prisma.question.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Question ${id} not found`);
    const allowed: Record<string, string[]> = {
      DRAFT: ['IN_REVIEW', 'ARCHIVED'],
      IN_REVIEW: ['DRAFT', 'PUBLISHED', 'REJECTED'],
      REJECTED: ['DRAFT'],
      PUBLISHED: ['ARCHIVED'],
      ARCHIVED: ['DRAFT'],
    };
    if (!allowed[current.status]?.includes(status)) {
      throw new ForbiddenException(
        `Invalid question status transition: ${current.status} -> ${status}`,
      );
    }
    if (status === 'PUBLISHED' && actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only administrators can publish questions');
    }
    if (
      status !== 'PUBLISHED' &&
      actorRole !== 'EDITOR' &&
      actorRole !== 'ADMIN'
    ) {
      throw new ForbiddenException('Only editors can submit question drafts');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.question.update({
        where: { id },
        data: { status: status as any, version: { increment: 1 } },
      });
      await tx.questionRevision.create({
        data: {
          questionId: id,
          editorId: actorId,
          beforeJson: JSON.stringify(current),
          afterJson: JSON.stringify(updated),
          reason: `STATUS_${status}`,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: `QUESTION_${status}`,
          entityType: 'Question',
          entityId: String(id),
          questionId: id,
          metadata: JSON.stringify({
            fromStatus: current.status,
            toStatus: status,
            fromVersion: current.version,
            toVersion: updated.version,
          }),
        },
      });
      return this.toResponse(updated);
    });
  }

  async rollback(
    id: number,
    revisionId: number,
    version: number,
    actorId: number,
  ) {
    const current = await this.prisma.question.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Question ${id} not found`);
    if (current.version !== version) {
      throw new ConflictException({
        success: false,
        error: {
          code: 'QUESTION_VERSION_CONFLICT',
          message: 'Question was changed by another editor',
          currentVersion: current.version,
        },
      });
    }
    const revision = await this.prisma.questionRevision.findFirst({
      where: { id: revisionId, questionId: id },
    });
    if (!revision) throw new NotFoundException('Question revision not found');
    let snapshot: any;
    try {
      snapshot = JSON.parse(revision.afterJson);
    } catch {
      throw new ConflictException('Question revision is invalid');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.question.update({
        where: { id },
        data: {
          title: String(snapshot.title),
          normalizedTitle: this.normalizeTitle(String(snapshot.title)),
          category: String(snapshot.category),
          answer: String(snapshot.answer ?? ''),
          difficulty: String(snapshot.difficulty ?? '基础'),
          tags:
            typeof snapshot.tags === 'string'
              ? snapshot.tags
              : JSON.stringify(snapshot.tags ?? []),
          // 回滚内容不自动改变当前发布状态，避免一次回滚意外下线线上题目。
          version: { increment: 1 },
        },
      });
      await tx.questionRevision.create({
        data: {
          questionId: id,
          editorId: actorId,
          beforeJson: JSON.stringify(current),
          afterJson: JSON.stringify(updated),
          reason: `ROLLBACK_REVISION_${revisionId}`,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'QUESTION_ROLLED_BACK',
          entityType: 'Question',
          entityId: String(id),
          questionId: id,
          metadata: JSON.stringify({
            revisionId,
            fromVersion: current.version,
            toVersion: updated.version,
          }),
        },
      });
      return this.toResponse(updated);
    });
  }

  async create(data: {
    title: string;
    category: string;
    answer?: string;
    difficulty?: string;
    tags?: string[];
  }) {
    try {
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
    } catch (error) {
      // 唯一索引是并发最终防线；把冲突翻译成客户端可处理的 409。
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          success: false,
          error: {
            code: 'QUESTION_TITLE_DUPLICATE',
            message: 'A question with the same title already exists',
          },
        });
      }
      throw error;
    }
  }

  async importMany(
    questions: Array<{
      title: string;
      category: string;
      answer?: string;
      difficulty?: string;
      tags?: string[];
    }>,
    importJobId?: string,
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
        ...(importJobId ? { importJobId } : {}),
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
      version: number;
      reason?: string;
    },
    editorId: number,
  ) {
    try {
      const question = await this.prisma.$transaction(async (tx) => {
        const current = await tx.question.findUnique({ where: { id } });
        if (!current) throw new NotFoundException(`Question ${id} not found`);
        if (current.version !== data.version) {
          throw new ConflictException({
            success: false,
            error: {
              code: 'QUESTION_VERSION_CONFLICT',
              message: 'Question was changed by another editor',
              currentVersion: current.version,
            },
          });
        }
        const updated = await tx.question.update({
          where: { id },
          data: {
            title: data.title.trim(),
            normalizedTitle: this.normalizeTitle(data.title),
            category: data.category,
            answer: data.answer ?? '',
            difficulty: data.difficulty ?? '基础',
            tags: JSON.stringify(data.tags ?? []),
            version: { increment: 1 },
          },
        });
        await tx.questionRevision.create({
          data: {
            questionId: id,
            editorId,
            beforeJson: JSON.stringify(current),
            afterJson: JSON.stringify(updated),
            reason: data.reason,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: editorId,
            action: 'QUESTION_UPDATED',
            entityType: 'Question',
            entityId: String(id),
            questionId: id,
            metadata: JSON.stringify({
              fromVersion: current.version,
              toVersion: updated.version,
            }),
          },
        });
        return updated;
      });
      return this.toResponse(question);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          success: false,
          error: {
            code: 'QUESTION_TITLE_DUPLICATE',
            message: 'A question with the same title already exists',
          },
        });
      }
      throw error;
    }
  }

  async remove(id: number, actorId: number) {
    const current = await this.prisma.question.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Question ${id} not found`);
    return this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'QUESTION_DELETED',
          entityType: 'Question',
          entityId: String(id),
          questionId: id,
          metadata: JSON.stringify({
            title: current.title,
            version: current.version,
          }),
        },
      });
      await tx.question.delete({ where: { id } });
      return this.toResponse(current);
    });
  }

  async clear() {
    const result = await this.prisma.question.deleteMany();
    return { deletedCount: result.count };
  }

  private normalizeTitle(title: string) {
    return title.trim().toLocaleLowerCase();
  }

  private toResponse<T extends { tags: string; reviewSuggestions?: string }>(
    question: T,
  ) {
    const { reviewSuggestions: _reviewSuggestions, ...publicQuestion } =
      question;
    return {
      ...publicQuestion,
      tags: JSON.parse(question.tags) as string[],
    };
  }
}
