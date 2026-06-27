import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = (Date.now() - startTime) / 1000;
        const route = request.route?.path ?? request.path;
        const statusCode = response.statusCode;

        this.metricsService.httpRequestDuration.observe(
          { method: request.method, route, status_code: statusCode },
          duration,
        );

        this.metricsService.httpRequestsTotal.inc({
          method: request.method,
          route,
          status_code: statusCode,
        });
      }),
    );
  }
}
