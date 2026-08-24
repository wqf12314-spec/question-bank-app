import { createHash } from 'node:crypto';
import { createRefreshToken } from './token.utils';

describe('createRefreshToken', () => {
  it('生成不同的原始令牌，并返回可复算的哈希', () => {
    const first = createRefreshToken();
    const second = createRefreshToken();

    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.tokenHash).not.toBe(first.rawToken);

    const recalculatedHash = createHash('sha256')
      .update(first.rawToken)
      .digest('hex');

    expect(first.tokenHash).toBe(recalculatedHash);
  });
});
