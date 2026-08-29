import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import jwt from 'jsonwebtoken';

export type AuthenticatedUser = {
  sub: number;
  role: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : null;
    const secret = process.env.ACCESS_TOKEN_SECRET;

    if (!token || !secret) {
      throw new UnauthorizedException('Access token is required');
    }

    try {
      const payload = jwt.verify(token, secret, {
        issuer: 'question-bank-api',
        audience: 'question-bank-client',
      });
      if (
        typeof payload !== 'object' ||
        typeof payload.sub !== 'number' ||
        typeof payload.role !== 'string'
      ) {
        throw new Error('Invalid access token payload');
      }
      request.user = { sub: payload.sub, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
