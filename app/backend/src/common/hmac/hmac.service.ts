import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class HmacService {
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.secret = this.config.getOrThrow<string>('WEBHOOK_SECRET');
  }

  /**
   * Signs a payload string and returns the hex HMAC-SHA256 digest.
   * Use this when sending outbound callbacks so the receiver can verify.
   */
  sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  /**
   * Timing-safe comparison of a received signature against the expected one.
   */
  verify(payload: string, signature: string): boolean {
    const expected = this.sign(payload);
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
