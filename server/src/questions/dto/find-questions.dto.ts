import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FindQuestionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  tag?: string;
}
