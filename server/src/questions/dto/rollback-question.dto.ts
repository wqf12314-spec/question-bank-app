import { IsInt, Min } from 'class-validator';

export class RollbackQuestionDto {
  @IsInt()
  @Min(1)
  version: number;
}
