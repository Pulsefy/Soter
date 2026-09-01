import { registerAs } from '@nestjs/config';

export default registerAs('config', () => ({
  /**
   * Shared secret for AI verification webhooks.
   */
  aiWebhookSecret: process.env.AI_WEBHOOK_SECRET,
}));
