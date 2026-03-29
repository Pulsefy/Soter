import { WebhookEvent } from '../webhook-events';

export type WebhookJobData = {
  subscriptionId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
};

export type WebhookDeliveryResult = {
  delivered: boolean;
  responseStatus: number;
};
