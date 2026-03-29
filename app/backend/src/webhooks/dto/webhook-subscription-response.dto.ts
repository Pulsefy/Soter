import { ApiProperty } from '@nestjs/swagger';
import { WebhookEvent, WEBHOOK_EVENTS } from '../webhook-events';

export class WebhookSubscriptionResponseDto {
  @ApiProperty({ example: 'ckxyz123' })
  id!: string;

  @ApiProperty({ example: 'https://ngo.example.org/hooks/soter' })
  url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENTS, isArray: true })
  events!: WebhookEvent[];

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-03-28T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-03-28T10:00:00.000Z' })
  updatedAt!: Date;
}
