import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from '../logging.interceptor';
import { LoggerService } from '../../logger/logger.service';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let mockLogger: { log: jest.Mock; error: jest.Mock };

  beforeEach(async () => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingInterceptor,
        {
          provide: LoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    interceptor = module.get<LoggingInterceptor>(LoggingInterceptor);
  });

  it('should log successful requests', done => {
    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          url: '/test',
          headers: {},
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => of({ data: 'test' }),
    };

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
      next: () => {
        // Look for the "Incoming" log call
        const logCall = mockLogger.log.mock.calls.find(args =>
          args.some(arg => typeof arg === 'string' && arg.includes('Incoming')),
        );

        expect(logCall).toBeDefined();
        const metadata = logCall?.find(
          arg => typeof arg === 'object' && arg !== null,
        );

        expect(metadata).toMatchObject({
          method: 'GET',
          url: '/test',
        });
        done();
      },
      error: err => done(err),
    });
  });

  it('should log failed requests with errors', done => {
    const testError = new Error('Test error message');
    (testError as any).stack = 'Error stack trace';

    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/test-error',
          headers: {},
        }),
        getResponse: () => ({ statusCode: 500 }),
      }),
    } as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => throwError(() => testError),
    };

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
      next: () => done(new Error('Should have failed')),
      error: () => {
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall).toBeDefined();

        // The metadata received contains duration and error message
        const metadata = errorCall.find(
          arg => typeof arg === 'object' && arg !== null,
        );

        expect(metadata).toMatchObject({
          statusCode: 500,
          error: 'Test error message',
        });

        done();
      },
    });
  });

  it('should maintain proper this binding', () => {
    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/test', headers: {} }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as ExecutionContext;
    const mockCallHandler: CallHandler = { handle: () => of({}) };

    expect(() =>
      interceptor.intercept(mockExecutionContext, mockCallHandler),
    ).not.toThrow();
  });
});
