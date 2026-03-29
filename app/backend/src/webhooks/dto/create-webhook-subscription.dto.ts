import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WEBHOOK_EVENTS, WebhookEvent } from '../webhook-events';

export class CreateWebhookSubscriptionDto {
  @ApiProperty({
    description: 'Destination URL that receives webhook events.',
    example: 'https://ngo.example.org/hooks/soter',
  })
  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  url!: string;

  @ApiProperty({
    description: 'Shared secret used to generate HMAC signatures.',
    example: 'ngo_shared_secret_123',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  secret!: string;

  @ApiProperty({
    description: 'Events this subscription should receive.',
    enum: WEBHOOK_EVENTS,
    isArray: true,
    example: ['claim.verified', 'campaign.completed'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events!: WebhookEvent[];

  @ApiProperty({
    description: 'Whether the subscription is active.',
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
