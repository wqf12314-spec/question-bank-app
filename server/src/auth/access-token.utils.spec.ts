import jwt from 'jsonwebtoken';
import { createAccessToken } from './access-token.utils';

describe('createAccessToken', () => {
  it('生成带用户身份、发行者和过期时间的 JWT', () => {
    const secret = 'test-only-secret';
    const token = createAccessToken({ sub: 7, role: 'LEARNER' }, secret);

    const payload = jwt.verify(token, secret, {
      issuer: 'question-bank-api',
      audience: 'question-bank-client',
    }) as jwt.JwtPayload & { sub: number; role: string };

    expect(payload.sub).toBe(7);
    expect(payload.role).toBe('LEARNER');
    expect(payload.iss).toBe('question-bank-api');
    expect(payload.aud).toBe('question-bank-client');
    expect(payload.exp).toBeDefined();
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
  });
});
