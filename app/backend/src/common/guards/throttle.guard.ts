import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SKIP_THROTTLE_KEY } from '../decorators/skip-throttle.decorator';
import { shouldSkipRateLimit } from '../config/rate-limit.config';

/**
 * Enhanced ThrottlerGuard that respects @SkipThrottle() decorator
 * and globally exempt paths (health, docs, metrics)
 *
 * This guard:
 * 1. Checks if route has @SkipThrottle() decorator
 * 2. Checks if path matches globally exempt patterns
 * 3. Falls back to standard ThrottlerGuard behavior
 */
@Injectable()
export class CostAwareThrottlerGuard extends ThrottlerGuard {
  constructor(@Inject(Reflector) protected reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipThrottle = this.reflector.get<boolean>(
      SKIP_THROTTLE_KEY,
      context.getHandler(),
    );

    if (skipThrottle) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const path = request.path ?? request.url ?? '';

    if (shouldSkipRateLimit(path)) {
      return true;
    }

    // Delegate to parent ThrottlerGuard
    return super.canActivate(context);
  }
}
