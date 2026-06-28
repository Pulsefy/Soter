import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';
import appConfig from '../../config/config';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@Injectable()
export class HmacGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const signature = request.headers['x-signature-hmac-sha256'] as string;

    if (!signature) {
      throw new UnauthorizedException('Missing signature header');
    }

    if (!request.rawBody) {
      throw new Error(
        'Raw body not available. Ensure `rawBody: true` is set in NestFactory.',
      );
    }

    const hmac = crypto.createHmac('sha256', this.config.aiWebhookSecret || '');
    const digest = hmac.update(request.rawBody).digest('hex');

    if (digest !== signature) {
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }
}
