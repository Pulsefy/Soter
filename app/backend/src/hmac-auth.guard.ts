import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class HmacAuthGuard implements CanActivate {
  private readonly logger = new Logger(HmacAuthGuard.name);
  private readonly secret: Buffer;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('AI_WEBHOOK_SECRET');
    if (!secretKey) {
      throw new Error('AI_WEBHOOK_SECRET is not configured.');
    }
    this.secret = Buffer.from(secretKey, 'utf8');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const signature = request.header('X-Signature-256');

    if (!signature) {
      this.logger.warn('Missing X-Signature-256 header');
      throw new UnauthorizedException('Missing signature');
    }

    if (!request.rawBody) {
      this.logger.error(
        'rawBody is not available on the request. Ensure rawBody middleware is used.',
      );
      throw new UnauthorizedException('Invalid request configuration');
    }

    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', this.secret)
      .update(request.rawBody)
      .digest('hex')}`;

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );

    if (!isValid) {
      this.logger.warn('Invalid HMAC signature');
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }
}
