import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateRole(userId: number, nextRole: string, actorId: number) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });
    if (!current) throw new NotFoundException(`User ${userId} not found`);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { role: nextRole as any },
        select: { id: true, email: true, role: true, updatedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'USER_ROLE_CHANGED',
          entityType: 'User',
          entityId: String(userId),
          metadata: JSON.stringify({
            fromRole: current.role,
            toRole: updated.role,
            targetEmail: current.email,
          }),
        },
      });
      return updated;
    });
  }

  async listAuditLogs(limit = 50) {
    const take = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
    return this.prisma.auditLog.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, email: true, role: true } },
      },
    });
  }
}
