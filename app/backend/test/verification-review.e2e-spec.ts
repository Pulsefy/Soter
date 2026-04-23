import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Verification Review Workflow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/verification/reviews/queue', () => {
    it('should return review queue with default pagination', () => {
      return request(app.getHttpServer())
        .get('/v1/verification/reviews/queue')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
          expect(res.body).toHaveProperty('page');
          expect(res.body).toHaveProperty('limit');
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('should filter by status', () => {
      return request(app.getHttpServer())
        .get('/v1/verification/reviews/queue?status=pending_review')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
        });
    });

    it('should handle pagination parameters', () => {
      return request(app.getHttpServer())
        .get('/v1/verification/reviews/queue?page=2&limit=10')
        .expect(200)
        .expect((res) => {
          expect(res.body.page).toBe(2);
          expect(res.body.limit).toBe(10);
        });
    });

    it('should reject invalid status values', () => {
      return request(app.getHttpServer())
        .get('/v1/verification/reviews/queue?status=invalid_status')
        .expect(400);
    });

    it('should reject invalid pagination values', () => {
      return request(app.getHttpServer())
        .get('/v1/verification/reviews/queue?page=0')
        .expect(400);
    });

    it('should reject limit exceeding maximum', () => {
      return request(app.getHttpServer())
        .get('/v1/verification/reviews/queue?limit=200')
        .expect(400);
    });
  });

  describe('POST /v1/verification/reviews/:claimId/submit', () => {
    const validReviewDto = {
      decision: 'approved',
      reason: 'All documents verified successfully',
      note: 'Contacted applicant for additional verification',
    };

    it('should validate review decision enum', () => {
      return request(app.getHttpServer())
        .post('/v1/verification/reviews/test-claim-id/submit')
        .send({
          ...validReviewDto,
          decision: 'invalid_decision',
        })
        .expect(400);
    });

    it('should require reason field', () => {
      return request(app.getHttpServer())
        .post('/v1/verification/reviews/test-claim-id/submit')
        .send({
          decision: 'approved',
          note: 'Some note',
        })
        .expect(400);
    });

    it('should enforce reason max length', () => {
      return request(app.getHttpServer())
        .post('/v1/verification/reviews/test-claim-id/submit')
        .send({
          decision: 'approved',
          reason: 'a'.repeat(501), // Exceeds 500 char limit
        })
        .expect(400);
    });

    it('should enforce note max length', () => {
      return request(app.getHttpServer())
        .post('/v1/verification/reviews/test-claim-id/submit')
        .send({
          decision: 'approved',
          reason: 'Valid reason',
          note: 'a'.repeat(1001), // Exceeds 1000 char limit
        })
        .expect(400);
    });

    it('should accept valid review with note', () => {
      return request(app.getHttpServer())
        .post('/v1/verification/reviews/nonexistent-claim/submit')
        .send(validReviewDto)
        .expect((res) => {
          // Will return 404 for nonexistent claim, but validates DTO
          expect([200, 404]).toContain(res.status);
        });
    });

    it('should accept valid review without note', () => {
      return request(app.getHttpServer())
        .post('/v1/verification/reviews/nonexistent-claim/submit')
        .send({
          decision: 'rejected',
          reason: 'Insufficient evidence provided',
        })
        .expect((res) => {
          expect([200, 404]).toContain(res.status);
        });
    });

    it('should strip unknown fields (whitelist)', () => {
      return request(app.getHttpServer())
        .post('/v1/verification/reviews/test-claim-id/submit')
        .send({
          ...validReviewDto,
          unknownField: 'should be stripped',
        })
        .expect((res) => {
          // Should not fail due to unknown field (whitelist: true)
          expect([200, 404]).toContain(res.status);
        });
    });
  });

  describe('Review Workflow Integration', () => {
    it('should have proper OpenAPI documentation', () => {
      return request(app.getHttpServer())
        .get('/api-json')
        .expect(200)
        .expect((res) => {
          const paths = res.body.paths;
          expect(paths).toHaveProperty('/v1/verification/reviews/queue');
          expect(paths).toHaveProperty(
            '/v1/verification/reviews/{claimId}/submit',
          );
        });
    });
  });
});
