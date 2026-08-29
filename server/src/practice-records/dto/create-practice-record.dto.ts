import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePracticeRecordDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  questionId: number;

  @IsUUID()
  clientRequestId: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  userAnswer?: string;

  @IsIn(['wrong', 'partial', 'correct'])
  result: string;

  @IsOptional()
  @IsIn(['write', 'view'])
  mode?: string;

  @IsOptional()
  @IsDateString()
  practicedAt?: string;
}
