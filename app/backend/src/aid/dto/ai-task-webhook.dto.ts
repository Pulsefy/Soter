import {
  AiVerificationWebhookDto,
  TaskStatus,
} from '../../webhooks/dto/ai-verification-webhook.dto';

export { AiVerificationWebhookDto, TaskStatus };

export class AiTaskWebhookDto extends AiVerificationWebhookDto {}
