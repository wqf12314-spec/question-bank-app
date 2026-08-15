import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  Equals,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateQuestionDto } from './create-question.dto';

export class ImportQuestionsDto {
  @Equals(1)
  schemaVersion: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions: CreateQuestionDto[];
}
