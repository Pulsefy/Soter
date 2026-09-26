import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { CorrelationPropagationUtil } from '../utils/correlation-propagation.util';

/**
 * Interceptor that ensures correlation ID is propagated to all outbound calls
 * from the request context
 */
@Injectable()
export class OutboundCorrelationInterceptor implements NestInterceptor {
  constructor(
    @Inject(CorrelationPropagationUtil)
    private readonly correlationUtil: CorrelationPropagationUtil,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const correlationId = this.correlationUtil.getCurrentCorrelationId(request);

    // Store correlation ID in request context for outbound calls
    if (correlationId) {
      (request as any).correlationId = correlationId;
    }

    return next.handle();
  }
}
