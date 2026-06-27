import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as crypto from 'crypto';
import { HmacGuard } from './hmac.guard';
import appConfig from '../config/config';

describe('HmacGuard', () => {
  let guard: HmacGuard;
  const secret = 'test-secret';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [appConfig],
        }),
      ],
      providers: [HmacGuard],
    })
      .overrideProvider(appConfig.KEY)
      .useValue({ aiWebhookSecret: secret })
      .compile();

    guard = module.get<HmacGuard>(HmacGuard);
  });

  const createMockContext = (headers: any, rawBody: Buffer | null) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          rawBody,
        }),
      }),
    }) as unknown as ExecutionContext;

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if signature header is missing', () => {
    const context = createMockContext({}, Buffer.from(''));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw an error if rawBody is not available', () => {
    const context = createMockContext(
      { 'x-signature-hmac-sha256': 'any-sig' },
      null,
    );
    expect(() => guard.canActivate(context)).toThrow(
      'Raw body not available. Ensure `rawBody: true` is set in NestFactory.',
    );
  });

  it('should throw UnauthorizedException for an invalid signature', () => {
    const body = JSON.stringify({ data: 'test' });
    const context = createMockContext(
      { 'x-signature-hmac-sha256': 'invalid-signature' },
      Buffer.from(body),
    );
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should return true for a valid signature', () => {
    const body = JSON.stringify({ data: 'test' });
    const hmac = crypto.createHmac('sha256', secret);
    const signature = hmac.update(body).digest('hex');

    const context = createMockContext(
      { 'x-signature-hmac-sha256': signature },
      Buffer.from(body),
    );

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });
});
