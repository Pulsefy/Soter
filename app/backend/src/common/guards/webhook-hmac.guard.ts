import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { HmacService } from '../hmac/hmac.service';
import { RedisService } from '../../../cache/redis.service';

/** Maximum age of a webhook timestamp before it is rejected (5 minutes). */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/** How long to remember a nonce to prevent replays (matches tolerance + buffer). */
const NONCE_TTL_SECONDS = 10 * 60;

/**
 * Guard that validates inbound webhook requests:
 *  1. Verifies the HMAC-SHA256 signature in `x-webhook-signature`.
 *  2. Rejects requests whose timestamp is outside the tolerance window.
 *  3. Rejects replayed requests by tracking the delivery nonce in Redis.
 *
 * The signature is computed over the raw JSON request body.
 * Apply with `@UseGuards(WebhookHmacGuard)` on the handler.
 */
@Injectable()
export class WebhookHmacGuard implements CanActivate {
  constructor(
    private readonly hmac: HmacService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const signature = req.headers['x-webhook-signature'];
    if (typeof signature !== 'string' || !signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Verify HMAC over the raw body string
    const rawBody: string =
      typeof (req as Request & { rawBody?: string }).rawBody === 'string'
        ? (req as Request & { rawBody?: string }).rawBody!
        : JSON.stringify(req.body);

    if (!this.hmac.verify(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Replay protection — timestamp window
    const body = req.body as { timestamp?: string; deliveryId?: string };
    const ts = body?.timestamp ? new Date(body.timestamp).getTime() : NaN;
    if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
      throw new UnauthorizedException(
        'Webhook timestamp out of acceptable range',
      );
    }

    // Replay protection — nonce dedup
    const nonce = body?.deliveryId;
    if (!nonce) {
      throw new UnauthorizedException('Missing deliveryId nonce');
    }

    const nonceKey = `webhook:nonce:${nonce}`;
    const seen = await this.redis.get(nonceKey);
    if (seen) {
      throw new UnauthorizedException('Webhook replay detected');
    }

    await this.redis.set(nonceKey, 1, NONCE_TTL_SECONDS);
    return true;
  }
}
