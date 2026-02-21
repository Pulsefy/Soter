import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  buildCorsOptions,
  createCorsOriginValidator,
  createHelmetMiddleware,
  createRateLimiter,
} from '../src/common/security/security.module';

type TestAppOptions = {
  enableDocs: boolean;
};

const setEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

const createTestApp = async ({ enableDocs }: TestAppOptions) => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });

  const configService = app.get(ConfigService);
  app.use(createHelmetMiddleware());
  app.use(createCorsOriginValidator(configService));
  app.enableCors(buildCorsOptions(configService));
  app.use(createRateLimiter(configService));

  if (enableDocs) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Pulsefy/Soter API')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.init();
  return app;
};

describe('Security (e2e)', () => {
  let app: INestApplication;

  const originalEnv = {
    API_RATE_LIMIT: process.env.API_RATE_LIMIT,
    THROTTLE_TTL: process.env.THROTTLE_TTL,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    CORS_ALLOW_CREDENTIALS: process.env.CORS_ALLOW_CREDENTIALS,
  };

  beforeAll(async () => {
    process.env.API_RATE_LIMIT = '1000';
    process.env.THROTTLE_TTL = '60000';
    process.env.CORS_ORIGINS = 'http://localhost:3000';
    process.env.CORS_ALLOW_CREDENTIALS = 'false';

    app = await createTestApp({ enableDocs: true });
  });

  afterAll(async () => {
    await app.close();

    setEnvValue('API_RATE_LIMIT', originalEnv.API_RATE_LIMIT);
    setEnvValue('THROTTLE_TTL', originalEnv.THROTTLE_TTL);
    setEnvValue('CORS_ORIGINS', originalEnv.CORS_ORIGINS);
    setEnvValue('CORS_ALLOW_CREDENTIALS', originalEnv.CORS_ALLOW_CREDENTIALS);
  });

  describe('Helmet Security Headers', () => {
    it('should have required security headers enabled', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['content-security-policy']).toBeUndefined();
    });
  });

  describe('CORS Policy', () => {
    it('should allow request from whitelisted origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:3000');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(
        response.headers['access-control-allow-credentials'],
      ).toBeUndefined();
    });

    it('should block request from non-whitelisted origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://malicious.com');

      expect(response.status).toBe(403);
      expect(response.text).toBe('Not allowed by CORS');
    });

    it('should handle preflight requests for allowed origins', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
    });
  });

  describe('Rate Limiting', () => {
    const windowMs = 1000;
    const initialNow = new Date('2025-01-01T00:00:00Z').getTime();
    let now = initialNow;
    let nowSpy: jest.SpyInstance;
    let rateLimitApp: INestApplication;

    beforeEach(async () => {
      process.env.API_RATE_LIMIT = '2';
      process.env.THROTTLE_TTL = windowMs.toString();
      process.env.CORS_ORIGINS = 'http://localhost:3000';
      process.env.CORS_ALLOW_CREDENTIALS = 'false';

      now = initialNow;
      nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
      rateLimitApp = await createTestApp({ enableDocs: true });
    });

    afterEach(async () => {
      await rateLimitApp.close();
      nowSpy.mockRestore();

      process.env.API_RATE_LIMIT = '1000';
      process.env.THROTTLE_TTL = '60000';
      process.env.CORS_ORIGINS = 'http://localhost:3000';
      process.env.CORS_ALLOW_CREDENTIALS = 'false';
    });

    it('should rate limit, include retry headers, and reset after the window passes', async () => {
      const server = rateLimitApp.getHttpServer();

      await request(server).get('/api/v1/');
      await request(server).get('/api/v1/');

      const limited = await request(server).get('/api/v1/');

      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      expect(limited.headers['ratelimit-limit']).toBeDefined();
      expect(limited.headers['ratelimit-reset']).toBeDefined();

      now += windowMs + 1;

      const resetResponse = await request(server).get('/api/v1/');
      expect(resetResponse.status).toBe(200);
    });

    it('should not rate limit health endpoints', async () => {
      const server = rateLimitApp.getHttpServer();

      for (let i = 0; i < 4; i += 1) {
        const response = await request(server).get('/api/v1/health');
        expect(response.status).toBe(200);
      }
    });

    it('should not rate limit docs endpoints', async () => {
      const server = rateLimitApp.getHttpServer();

      for (let i = 0; i < 4; i += 1) {
        const response = await request(server).get('/api/docs');
        expect(response.status).toBe(200);
      }
    });
  });

  describe('Docs Endpoint', () => {
    it('should serve Swagger UI', async () => {
      const response = await request(app.getHttpServer()).get('/api/docs');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Swagger UI');
    });
  });
});
