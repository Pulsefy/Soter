import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Deprecation Headers (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/deprecated-test (GET) should return deprecation headers', () => {
    return request(app.getHttpServer())
      .get('/api/deprecated-test')
      .expect(200)
      .expect((res) => {
        // Check Deprecation header
        expect(res.header['deprecation']).toBe('2025-01-01');
        
        // Check Sunset header
        expect(res.header['sunset']).toBe('2025-12-31');
        
        // Check Link header
        const linkHeader = res.header['link'];
        expect(linkHeader).toContain('</api/v1/health>; rel="alternate"');
        expect(linkHeader).toContain('<https://docs.pulsefy.com/migration>; rel="deprecation"');
      });
  });

  it('/api/health (GET) should NOT return deprecation headers', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.header['deprecation']).toBeUndefined();
        expect(res.header['sunset']).toBeUndefined();
        expect(res.header['link']).toBeUndefined();
      });
  });
});
