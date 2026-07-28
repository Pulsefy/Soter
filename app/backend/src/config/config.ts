import { registerAs } from '@nestjs/config';

export default registerAs('config', () => ({
  /**
   * Used by HmacGuard (expects injection token: appConfig.KEY)
   *
   * NOTE: Keep env names consistent with service usage.
   */
  aiWebhookSecret: process.env.AI_WEBHOOK_SECRET,
}));
