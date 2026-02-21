import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { LoggerService } from '../../logger/logger.service';

// Type for the response data
interface ResponseData {
  [key: string]: unknown;
}

// Type for error object (extends Error to include stack)
interface ErrorWithStack extends Error {
  status?: number;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || 'unknown';
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (data: ResponseData) => {
          const latency = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.logger.log(
            {
              type: 'request_completed',
              method,
              url,
              statusCode,
              latency: `${latency}ms`,
              ip,
              userAgent,
              responseSize: JSON.stringify(data).length,
            },
            'HTTP',
          );
        },
        error: (error: ErrorWithStack) => {
          const latency = Date.now() - startTime;

          this.logger.error(
            {
              type: 'request_failed',
              method,
              url,
              statusCode: error.status || 500,
              latency: `${latency}ms`,
              ip,
              userAgent,
              error: {
                message: error.message,
                name: error.name,
              },
            },
            error.stack, // Now TypeScript knows stack exists
            'HTTP',
          );
        },
      }),
    );
  }
}
