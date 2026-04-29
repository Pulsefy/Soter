import { IsString, IsNotEmpty } from 'class-validator';

export class FinalizeUploadDto {
  @IsString()
  @IsNotEmpty()
  ownerId: string;
}
