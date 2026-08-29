import { IsIn } from 'class-validator';

export class UpdateUserRoleDto {
  @IsIn(['LEARNER', 'EDITOR', 'ADMIN'])
  role: string;
}
