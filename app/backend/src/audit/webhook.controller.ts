import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { SessionService } from '../session/session.service';
import { HmacGuard } from './hmac.guard';
import { WebhooksService } from './webhooks.service';
import { AiVerificationPayloadDto } from '../ai-verification.dto';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly webhooksService: WebhooksService, // Injected to resolve missing instance property
  ) {}

  @Post('ai-verification')
  @UseGuards(HmacGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive AI verification results',
    description:
      'A secure endpoint for AI services to post back verification results. Requires HMAC signature.',
  })
  @ApiHeader({
    name: 'X-Signature-Hmac-Sha256',
    description: 'HMAC-SHA256 signature of the raw request body.',
    required: true,
  })
  @ApiOkResponse({
    description: 'Webhook received and processed successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or missing HMAC signature.',
  })
  async handleAiVerification(@Body() payload: AiVerificationPayloadDto) {
    const result = await this.sessionService.submitToStep(
      payload.sessionId,
      'undefined', // stepId is not on this DTO, providing a placeholder
      { submissionKey: payload.eventId, payload: payload.details },
    );

    return { status: 'received', isIdempotent: result.isIdempotent };
  }
}
