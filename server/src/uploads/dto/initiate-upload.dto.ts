import {
  IsHexadecimal,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024)
  size: number;

  @IsString()
  @MaxLength(120)
  mime: string;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  @IsHexadecimal()
  sha256?: string;
}
