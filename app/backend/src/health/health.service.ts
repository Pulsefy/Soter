import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  check() {
    const version = process.env.npm_package_version ?? '0.0.0';

    return {
      status: 'ok',
      service: 'backend',
      version,
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      timestamp: new Date().toISOString(),
    };
  }

  logHealthCheck(requestId?: string) {
    this.logger.log('Health check endpoint accessed', 'HealthService', {
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  logErrorAttempt(requestId?: string) {
    this.logger.warn('Error endpoint triggered for testing', 'HealthService', {
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
