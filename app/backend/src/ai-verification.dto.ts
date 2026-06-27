import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsObject,
} from 'class-validator';

export enum VerificationStatus {
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  NEEDS_REVIEW = 'needs_review',
}

export class AiVerificationPayloadDto {
  @IsUUID()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsEnum(VerificationStatus)
  status: VerificationStatus;

  @IsObject()
  details: Record<string, any>;
}
