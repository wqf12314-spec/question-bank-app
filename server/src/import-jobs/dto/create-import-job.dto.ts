import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateImportJobDto {
  @IsInt()
  @Min(1)
  fileObjectId: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  pipelineVersion?: string;
}
