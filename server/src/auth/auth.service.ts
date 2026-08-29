import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { createAccessToken } from './access-token.utils';
import { createRefreshToken } from './token.utils';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private getAccessTokenSecret() {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) {
      throw new Error('ACCESS_TOKEN_SECRET is required');
    }
    return secret;
  }

  private hashRefreshToken(rawToken: string) {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async register(data: RegisterDto) {
    const email = data.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
        },
      });

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      };
    } catch (error) {
      // 唯一索引是并发注册时的最终防线，不能只依赖前置查询。
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }
  async verifyCredentials(data: LoginDto) {
    const email = data.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    const passwordMatches = user
      ? await bcrypt.compare(data.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      // 账号不存在和密码错误统一返回 401，避免暴露注册邮箱。
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  async login(data: LoginDto) {
    const user = await this.verifyCredentials(data);
    return this.issueSession(user);
  }

  private async issueSession(user: {
    id: number;
    email: string;
    role: string;
  }) {
    const accessTokenSecret = this.getAccessTokenSecret();
    const { rawToken, tokenHash } = createRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken: createAccessToken(
        { sub: user.id, role: user.role },
        accessTokenSecret,
      ),
      refreshToken: rawToken,
      user,
    };
  }

  async refresh(rawToken: string) {
    const tokenHash = this.hashRefreshToken(rawToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const next = createRefreshToken();
    const nextExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const accessTokenSecret = this.getAccessTokenSecret();
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        // 并发使用同一个 Refresh Token 时，只有第一个请求能轮换成功。
        throw new UnauthorizedException('Invalid refresh token');
      }
      await tx.refreshSession.create({
        data: {
          userId: session.userId,
          tokenHash: next.tokenHash,
          expiresAt: nextExpiresAt,
        },
      });
    });

    const user = {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };
    return {
      accessToken: createAccessToken(
        { sub: user.id, role: user.role },
        accessTokenSecret,
      ),
      refreshToken: next.rawToken,
      user,
    };
  }

  async logout(rawToken: string) {
    const tokenHash = this.hashRefreshToken(rawToken);
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }
  async logoutAll(rawToken: string) {
    const tokenHash = this.hashRefreshToken(rawToken);
    const currentSession = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !currentSession ||
      currentSession.revokedAt ||
      currentSession.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshSession.updateMany({
      where: {
        userId: currentSession.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { success: true };
  }
}
