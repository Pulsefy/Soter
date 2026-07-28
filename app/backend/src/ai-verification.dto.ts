import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsObject,
  IsOptional,
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

  @IsOptional()
  @IsString()
  campaignRef?: string;

  @IsOptional()
  @IsString()
  claimId?: string;

  @IsOptional()
  @IsString()
  packageId?: string;
}
