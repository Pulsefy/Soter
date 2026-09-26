import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { HmacService } from '../hmac/hmac.service';

/**
 * Guard that validates inbound webhook requests:
 *  1. Verifies the HMAC-SHA256 signature in `X-Signature-256`.
 *
 * The signature is computed over the raw JSON request body.
 * Apply with `@UseGuards(WebhookHmacGuard)` on the handler.
 */
@Injectable()
export class WebhookHmacGuard implements CanActivate {
  constructor(private readonly hmac: HmacService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const signature = req.headers['x-signature-256'];
    if (typeof signature !== 'string' || !signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const rawBody =
      (req as Request & { rawBody?: Buffer | string }).rawBody ??
      (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    if (!this.hmac.verify(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
