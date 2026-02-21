import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Get or generate request ID
    const existingRequestId = request.headers['x-request-id'] as string;
    const requestId = existingRequestId || this.generateRequestId();

    // Set request ID in headers
    request.headers['x-request-id'] = requestId;
    response.set('X-Request-ID', requestId);

    return next.handle();
  }

  private generateRequestId(): string {
    return (
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    ).toUpperCase();
  }
}
