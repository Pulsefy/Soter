import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  aiWebhookSecret: process.env.AI_WEBHOOK_SECRET,
}));
