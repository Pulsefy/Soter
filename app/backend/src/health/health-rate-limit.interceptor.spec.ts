import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Response } from 'express';
import request from 'supertest';
import {
  HEALTH_CACHE_HEADER,
  HealthRateLimitInterceptor,
} from './health-rate-limit.interceptor';

const probe = jest.fn<{ ready: boolean; checkNo: number }, []>();

@Controller('health')
class ProbeController {
  @Get('ready')
  @UseInterceptors(HealthRateLimitInterceptor)
  ready(@Res({ passthrough: true }) res: Response) {
    const result = probe();
    if (!result.ready) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}

describe('HealthRateLimitInterceptor', () => {
  let app: INestApplication;
  let checkNo: number;
  let ready: boolean;
  const config: Record<string, string> = {
    HEALTH_RATE_LIMIT_MAX: '5',
    HEALTH_RATE_LIMIT_WINDOW_MS: '10000',
  };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    checkNo = 0;
    ready = true;
    probe.mockReset().mockImplementation(() => ({ ready, checkNo: ++checkNo }));

    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        HealthRateLimitInterceptor,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // Lets tests simulate distinct clients via X-Forwarded-For.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  const hit = () => request(app.getHttpServer()).get('/health/ready');

  it('throttles a burst by replaying the last-known status instead of rejecting', async () => {
    const responses: request.Response[] = [];
    for (let i = 0; i < 20; i++) {
      responses.push(await hit());
    }

    // No request is ever rejected...
    expect(responses.every(r => r.status === 200)).toBe(true);
    // ...but only the in-budget requests reached the downstream checks.
    expect(probe).toHaveBeenCalledTimes(5);

    const fresh = responses.slice(0, 5);
    const throttled = responses.slice(5);
    expect(fresh.map(r => r.headers['x-health-cache'])).toEqual(
      Array(5).fill('fresh'),
    );
    expect(
      throttled.every(
        r =>
          r.headers[HEALTH_CACHE_HEADER.toLowerCase()] === 'throttled' &&
          r.body.checkNo === 5,
      ),
    ).toBe(true);
  });

  it('does not disrupt a normal monitoring cadence', async () => {
    // A monitor polling every 5s stays well inside a 5-per-10s budget.
    for (let i = 1; i <= 12; i++) {
      const res = await hit();
      expect(res.headers['x-health-cache']).toBe('fresh');
      expect(res.body.checkNo).toBe(i);
      jest.advanceTimersByTime(5000);
    }
    expect(probe).toHaveBeenCalledTimes(12);
  });

  it('serves fresh checks again once the window resets', async () => {
    for (let i = 0; i < 8; i++) {
      await hit();
    }
    expect(probe).toHaveBeenCalledTimes(5);

    jest.advanceTimersByTime(10_000);
    const res = await hit();
    expect(res.headers['x-health-cache']).toBe('fresh');
    expect(probe).toHaveBeenCalledTimes(6);
  });

  it('replays a not-ready status with its 503 so throttling never masks an outage', async () => {
    ready = false;
    for (let i = 0; i < 5; i++) {
      await hit();
    }

    const res = await hit();
    expect(res.status).toBe(503);
    expect(res.headers['x-health-cache']).toBe('throttled');
    expect(res.body).toMatchObject({ ready: false });
  });

  it('tracks budgets per client', async () => {
    for (let i = 0; i < 6; i++) {
      await hit().set('X-Forwarded-For', '10.0.0.1');
    }
    const noisy = await hit().set('X-Forwarded-For', '10.0.0.1');
    expect(noisy.headers['x-health-cache']).toBe('throttled');

    // A different client (e.g. the load balancer) is unaffected.
    const monitor = await hit().set('X-Forwarded-For', '10.0.0.2');
    expect(monitor.headers['x-health-cache']).toBe('fresh');
  });

  it('can be disabled via HEALTH_RATE_LIMIT_ENABLED=false', async () => {
    config.HEALTH_RATE_LIMIT_ENABLED = 'false';
    try {
      await app.close();
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
        providers: [
          HealthRateLimitInterceptor,
          {
            provide: ConfigService,
            useValue: { get: (key: string) => config[key] },
          },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();

      for (let i = 0; i < 10; i++) {
        await hit();
      }
      expect(probe).toHaveBeenCalledTimes(10);
    } finally {
      delete config.HEALTH_RATE_LIMIT_ENABLED;
    }
  });
});
