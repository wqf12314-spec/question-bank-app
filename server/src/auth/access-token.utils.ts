import jwt from 'jsonwebtoken';

export type AccessTokenPayload = {
  sub: number;
  role: string;
};

export function createAccessToken(payload: AccessTokenPayload, secret: string) {
  // Access Token 只做短期身份证明，过期后必须走 Refresh Session。
  return jwt.sign(payload, secret, {
    expiresIn: '15m',
    issuer: 'question-bank-api',
    audience: 'question-bank-client',
  });
}
