import { createHash, randomBytes } from 'node:crypto';

export function createRefreshToken() {
  const rawToken = randomBytes(32).toString('base64url');

  // 数据库只保存哈希，避免数据库泄露后令牌可直接使用。
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return { rawToken, tokenHash };
}
