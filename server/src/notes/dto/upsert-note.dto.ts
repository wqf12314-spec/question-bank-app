import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpsertNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;
}
