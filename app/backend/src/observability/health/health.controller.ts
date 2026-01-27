import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  private readonly startTime: Date;

  constructor(
    private health: HealthCheckService,
    private healthService: HealthService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
  ) {
    this.startTime = new Date();
  }

  @Get()
  @HealthCheck()
  async check() {
    const uptime = this.getUptime();
    const version = process.env.APP_VERSION || '1.0.0';

    const healthCheck = await this.health.check([
      // Database connectivity check
      () => this.db.pingCheck('database', { timeout: 3000 }),

      // Memory heap check (RSS < 300MB)
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),

      // Memory RSS check (RSS < 300MB)
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),

      // Queue connectivity check
      () => this.healthService.checkQueue('queue'),

      // Redis connectivity check (if applicable)
      () => this.healthService.checkRedis('redis'),
    ]);

    return {
      ...healthCheck,
      info: {
        version,
        uptime: uptime.formatted,
        uptimeSeconds: uptime.seconds,
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
    };
  }

  @Get('liveness')
  @HealthCheck()
  liveness() {
    // Simple liveness check - just confirm the service is running
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  @HealthCheck()
  async readiness() {
    // Readiness check - verify all dependencies are ready
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.healthService.checkQueue('queue'),
    ]);
  }

  private getUptime(): { formatted: string; seconds: number } {
    const uptimeMs = Date.now() - this.startTime.getTime();
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let formatted = '';
    if (days > 0) formatted += `${days}d `;
    if (hours % 24 > 0) formatted += `${hours % 24}h `;
    if (minutes % 60 > 0) formatted += `${minutes % 60}m `;
    formatted += `${seconds % 60}s`;

    return {
      formatted: formatted.trim(),
      seconds,
    };
  }
}
