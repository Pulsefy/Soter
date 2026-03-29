export const WEBHOOK_EVENTS = [
  'claim.verified',
  'claim.disbursed',
  'campaign.completed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_QUEUE = 'webhooks';

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
