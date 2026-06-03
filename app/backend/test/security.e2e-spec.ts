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
  app.use(createHelmetMiddleware(configService));
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
    CORS_ALLOWLIST: process.env.CORS_ALLOWLIST,
    CORS_PRODUCTION_ORIGINS: process.env.CORS_PRODUCTION_ORIGINS,
    CORS_ALLOW_CREDENTIALS: process.env.CORS_ALLOW_CREDENTIALS,
  };

  beforeAll(async () => {
    process.env.API_RATE_LIMIT = '1000';
    process.env.THROTTLE_TTL = '60000';
    process.env.CORS_ALLOWLIST = 'http://localhost:3000';
    process.env.CORS_PRODUCTION_ORIGINS = 'https://app.example.com';
    process.env.CORS_ALLOW_CREDENTIALS = 'false';

    app = await createTestApp({ enableDocs: true });
  });

  afterAll(async () => {
    await app.close();

    setEnvValue('API_RATE_LIMIT', originalEnv.API_RATE_LIMIT);
    setEnvValue('THROTTLE_TTL', originalEnv.THROTTLE_TTL);
    setEnvValue('CORS_ORIGINS', originalEnv.CORS_ORIGINS);
    setEnvValue('CORS_ALLOWLIST', originalEnv.CORS_ALLOWLIST);
    setEnvValue('CORS_PRODUCTION_ORIGINS', originalEnv.CORS_PRODUCTION_ORIGINS);
    setEnvValue('CORS_ALLOW_CREDENTIALS', originalEnv.CORS_ALLOW_CREDENTIALS);
  });

  describe('Helmet Security Headers', () => {
    it('should have required security headers enabled (development mode)', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(response.headers['cross-origin-resource-policy']).toBe(
        'same-origin',
      );
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers['x-permitted-cross-domain-policies']).toBe(
        'none',
      );
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['content-security-policy']).toBeUndefined();
    });

    it('should have production security headers in production mode', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ALLOWLIST = 'https://app.pulsefy.com';
      process.env.CORS_ALLOW_CREDENTIALS = 'false';

      const prodApp = await createTestApp({ enableDocs: false });
      const response = await request(prodApp.getHttpServer()).get(
        '/api/v1/health',
      );

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['cross-origin-opener-policy']).toBe(
        'same-origin',
      );

      await prodApp.close();

      // Reset to development
      process.env.NODE_ENV = 'development';
      process.env.CORS_ALLOWLIST = 'http://localhost:3000';
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

  describe('CORS Allowlist with Wildcards', () => {
    let wildcardApp: INestApplication;

    beforeEach(async () => {
      process.env.CORS_ALLOWLIST =
        'https://*.vercel.app,https://app.example.com,https://pr-*.example-app.vercel.app';
      process.env.CORS_PRODUCTION_ORIGINS = 'https://app.example.com';
      wildcardApp = await createTestApp({ enableDocs: false });
    });

    afterEach(async () => {
      await wildcardApp.close();
      process.env.CORS_ALLOWLIST = 'http://localhost:3000';
      process.env.CORS_PRODUCTION_ORIGINS = 'https://app.example.com';
    });

    it('should allow requests from Vercel preview deployments', async () => {
      const testOrigins = [
        'https://my-app-git-feature-branch-username.vercel.app',
        'https://my-app-abc123.vercel.app',
        'https://pr-123-example-app.vercel.app',
      ];

      for (const origin of testOrigins) {
        const response = await request(wildcardApp.getHttpServer())
          .get('/api/v1/health')
          .set('Origin', origin);

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
      }
    });

    it('should allow requests from exact production domain', async () => {
      const response = await request(wildcardApp.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'https://app.example.com');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(
        'https://app.example.com',
      );
    });

    it('should block requests from non-matching wildcard patterns', async () => {
      const maliciousOrigins = [
        'https://malicious.vercel.app.evil.com',
        'https://evil.com',
        'https://vercel.app.malicious.com',
        'https://pr-123-malicious-app.vercel.app',
      ];

      for (const origin of maliciousOrigins) {
        const response = await request(wildcardApp.getHttpServer())
          .get('/api/v1/health')
          .set('Origin', origin);

        expect(response.status).toBe(403);
        expect(response.text).toBe('Not allowed by CORS');
      }
    });

    it('should handle preflight requests for wildcard patterns', async () => {
      const response = await request(wildcardApp.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', 'https://my-app-abc123.vercel.app')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(
        'https://my-app-abc123.vercel.app',
      );
    });
  });

  describe('Sensitive Endpoint Protection', () => {
    let sensitiveApp: INestApplication;

    beforeEach(async () => {
      process.env.CORS_ALLOWLIST =
        'https://*.vercel.app,https://app.example.com';
      process.env.CORS_PRODUCTION_ORIGINS = 'https://app.example.com';
      process.env.API_KEY = 'test-admin-key';
      sensitiveApp = await createTestApp({ enableDocs: false });
    });

    afterEach(async () => {
      await sensitiveApp.close();
      process.env.CORS_ALLOWLIST = 'http://localhost:3000';
      process.env.CORS_PRODUCTION_ORIGINS = 'https://app.example.com';
      delete process.env.API_KEY;
    });

    it('should allow sensitive endpoints from production origins', async () => {
      const response = await request(sensitiveApp.getHttpServer())
        .get('/api/v1/admin/search?q=test&entity=claims')
        .set('Origin', 'https://app.example.com')
        .set('x-api-key', 'test-admin-key');

      // Should not be blocked by CORS (may fail for other reasons like missing data)
      expect(response.status).not.toBe(403);
    });

    it('should block sensitive endpoints from preview deployments', async () => {
      const response = await request(sensitiveApp.getHttpServer())
        .get('/api/v1/admin/search?q=test&entity=claims')
        .set('Origin', 'https://my-app-abc123.vercel.app')
        .set('x-api-key', 'test-admin-key');

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        'Sensitive endpoint not accessible from this origin',
      );
    });

    it('should allow sensitive endpoints without origin header (same-origin)', async () => {
      const response = await request(sensitiveApp.getHttpServer())
        .get('/api/v1/admin/search?q=test&entity=claims')
        .set('x-api-key', 'test-admin-key');

      // Should not be blocked by CORS (may fail for other reasons)
      expect(response.status).not.toBe(403);
    });

    it('should block sensitive endpoints when no production origins configured', async () => {
      delete process.env.CORS_PRODUCTION_ORIGINS;
      const noConfigApp = await createTestApp({ enableDocs: false });

      const response = await request(noConfigApp.getHttpServer())
        .get('/api/v1/admin/search?q=test&entity=claims')
        .set('Origin', 'https://app.example.com')
        .set('x-api-key', 'test-admin-key');

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        'Sensitive endpoint access requires production domain configuration',
      );

      await noConfigApp.close();
    });
  });

  describe('Legacy CORS_ORIGINS Compatibility', () => {
    let legacyApp: INestApplication;

    beforeEach(async () => {
      delete process.env.CORS_ALLOWLIST;
      process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:3001';
      legacyApp = await createTestApp({ enableDocs: false });
    });

    afterEach(async () => {
      await legacyApp.close();
      process.env.CORS_ALLOWLIST = 'http://localhost:3000';
      delete process.env.CORS_ORIGINS;
    });

    it('should fall back to CORS_ORIGINS when CORS_ALLOWLIST not set', async () => {
      const response = await request(legacyApp.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:3001');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3001',
      );
    });

    it('should block non-legacy origins', async () => {
      const response = await request(legacyApp.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173');

      expect(response.status).toBe(403);
      expect(response.text).toBe('Not allowed by CORS');
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
      process.env.CORS_ALLOWLIST = 'http://localhost:3000';
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
      process.env.CORS_ALLOWLIST = 'http://localhost:3000';
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
