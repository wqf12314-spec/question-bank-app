import { IsIn } from 'class-validator';

export class TransitionQuestionDto {
  @IsIn(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED'])
  status: string;
}
