import { IsString, IsInt, IsNotEmpty, Min, Max } from 'class-validator';

export class CreateUploadSessionDto {
  @IsString()
  @IsNotEmpty()
  ownerId: string;

  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024) // 100MB limit
  totalSize: number;
}
