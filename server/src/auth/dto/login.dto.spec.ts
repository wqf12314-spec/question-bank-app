import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';

describe.each([LoginDto, RegisterDto])('%s account validation', (Dto) => {
  it.each(['user@example.com', '13800138000'])('accepts %s', async (email) => {
    expect(
      await validate(
        Object.assign(new Dto(), { email, password: 'test-password' }),
      ),
    ).toHaveLength(0);
  });
  it.each(['', '123', '138001380000', 'user@', null, 13800138000])(
    'rejects invalid account %s',
    async (email) => {
      const errors = await validate(
        Object.assign(new Dto(), { email, password: 'test-password' }),
      );
      expect(errors.some((error) => error.property === 'email')).toBe(true);
    },
  );
});
