/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();

    // Capture the original end function
    const originalEnd = res.end;
    const self = this;

    // Override the end function to capture metrics
    res.end = function (...args: any[]): any {
      // Calculate duration
      const duration = (Date.now() - start) / 1000; // Convert to seconds

      // Get route pattern (fallback to path if route not available)
      const route = req.route?.path || req.path;
      const method = req.method;
      const statusCode = res.statusCode;

      // Record metrics
      self.metricsService.incrementHttpRequest(method, route, statusCode);
      self.metricsService.recordHttpDuration(method, route, duration);

      // Call the original end function
      return originalEnd.apply(res, args);
    };

    next();
  }
}
