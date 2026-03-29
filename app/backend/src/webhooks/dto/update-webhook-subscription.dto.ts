import { PartialType } from '@nestjs/swagger';
import { CreateWebhookSubscriptionDto } from './create-webhook-subscription.dto';

export class UpdateWebhookSubscriptionDto extends PartialType(
  CreateWebhookSubscriptionDto,
) {}
