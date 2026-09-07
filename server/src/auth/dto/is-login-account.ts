import { isEmail, registerDecorator } from 'class-validator';

export function IsLoginAccount(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isLoginAccount',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            (isEmail(value) || /^1[3-9]\d{9}$/.test(value))
          );
        },
        defaultMessage: () =>
          'Account must be an email or an 11-digit mobile number',
      },
    });
  };
}
