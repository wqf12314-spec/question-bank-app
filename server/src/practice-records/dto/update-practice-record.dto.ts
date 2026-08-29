import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePracticeRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  userAnswer?: string;

  @IsIn(['wrong', 'partial', 'correct'])
  result: string;

  @IsOptional()
  @IsIn(['write', 'view'])
  mode?: string;
}
