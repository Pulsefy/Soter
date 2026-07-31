import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';

describe('Health deployment metadata (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health includes deployment metadata alongside existing health fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'backend',
        version: expect.any(String),
        environment: expect.any(String),
        timestamp: expect.any(String),
        deployment: {
          gitSha: expect.any(String),
          environment: expect.any(String),
          buildTimestamp: expect.any(String),
        },
        checks: expect.objectContaining({
          process: expect.objectContaining({ status: 'up' }),
        }),
      }),
    );
  });

  it('falls back to safe "unknown" defaults when GIT_SHA/BUILD_TIMESTAMP are not configured', async () => {
    // This test environment does not set GIT_SHA or BUILD_TIMESTAMP, which
    // mirrors a fresh local/dev deployment with no CI-injected build info.
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body.deployment.gitSha).toBe('unknown');
    expect(res.body.deployment.buildTimestamp).toBe('unknown');
    expect(res.body.deployment.environment).toBe(res.body.environment);
  });

  it('GET /api/v1/health/live returns the same deployment metadata shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);

    expect(res.body.deployment).toEqual({
      gitSha: expect.any(String),
      environment: expect.any(String),
      buildTimestamp: expect.any(String),
    });
  });
});
