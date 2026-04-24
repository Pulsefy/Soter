// test/rate-limit.integration.spec.ts (fixed)
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { RateLimitService } from '../src/common/rate-limit/rate-limit.service';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard';

describe('Rate Limiting Integration', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Rate Limit Service', () => {
    it('should be defined', () => {
      const rateLimitService = moduleFixture.get(RateLimitService);
      expect(rateLimitService).toBeDefined();
    });
  });

  describe('Rate Limit Guard', () => {
    it('should be defined', () => {
      const rateLimitGuard = moduleFixture.get(RateLimitGuard);
      expect(rateLimitGuard).toBeDefined();
    });
  });
});
