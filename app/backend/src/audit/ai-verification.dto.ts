import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsObject,
  IsUUID,
} from 'class-validator';

export enum VerificationStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class AiVerificationPayloadDto {
  @IsUUID('4')
  idempotencyKey: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  stepId: string;

  @IsEnum(VerificationStatus)
  status: VerificationStatus;

  @IsObject()
  output: Record<string, any>;
}
