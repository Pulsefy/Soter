import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService } from '../logger/logger.service';
import { Request, Response } from 'express';

interface ExtendedRequest extends Request {
  requestId?: string;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<ExtendedRequest>();
    const response = context
      .switchToHttp()
      .getResponse<Response & { statusCode: number }>();

    const method = request.method;
    const url = request.url;
    const requestId = request.requestId;
    const startTime = Date.now();

    // Log incoming request
    this.logger.log(`Incoming ${method} request`, 'LoggingInterceptor', {
      requestId,
      method,
      url,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(`${method} ${url} completed`, 'LoggingInterceptor', {
            requestId,
            statusCode: response.statusCode,
            duration: `${duration}ms`,
          });
        },
        error: error => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `Error in ${method} ${url}`,
            (error as { stack?: string }).stack,
            'LoggingInterceptor',
            {
              requestId,
              statusCode: (error as { status?: number }).status || 500,
              duration: `${duration}ms`,
              error: (error as { message?: string }).message,
            },
          );
        },
      }),
    );
  }
}
