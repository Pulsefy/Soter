/* eslint-disable @typescript-eslint/unbound-method */
import { RequestCorrelationMiddleware } from '../request-correlation.middleware';
import { LoggerService } from '../../logger/logger.service';
import { CORRELATION_ID_HEADER } from '../../common/utils/correlation-id.util';
import { Request, Response } from 'express';

// Mock types
interface MockRequest extends Partial<Request> {
  headers: Record<string, string | undefined>;
  correlationId?: string;
  requestId?: string;
  method?: string;
  url?: string;
  ip?: string;
}

interface MockResponse extends Partial<Response> {
  setHeader: jest.Mock;
  on: jest.Mock;
  statusCode?: number;
}

describe('RequestCorrelationMiddleware', () => {
  let middleware: RequestCorrelationMiddleware;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockAsyncStorage: { run: jest.Mock };

  beforeEach(() => {
    // Create mock async storage
    mockAsyncStorage = {
      run: jest.fn((_store, callback) => callback()),
    };

    // Create mock logger
    mockLogger = {
      getAsyncLocalStorage: jest.fn().mockReturnValue(mockAsyncStorage),
      debug: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      verbose: jest.fn(),
      getLogger: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    middleware = new RequestCorrelationMiddleware(mockLogger);
  });

  it('should generate correlation ID if not present in headers', () => {
    const req: MockRequest = {
      headers: {},
      method: 'GET',
      url: '/test',
      ip: '127.0.0.1',
    };

    const res: MockResponse = {
      setHeader: jest.fn(),
      on: jest.fn(),
    };

    const next = jest.fn();

    middleware.use(req as Request, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      ),
    );

    expect(req.correlationId).toBeDefined();
    expect(req.requestId).toBeDefined();
    expect(req.correlationId).toBe(req.requestId);
    expect(mockAsyncStorage.run).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('should propagate existing correlation ID from x-correlation-id header', () => {
    const existingId = '123e4567-e89b-12d3-a456-426614174000';
    const req: MockRequest = {
      headers: { [CORRELATION_ID_HEADER]: existingId },
      method: 'GET',
      url: '/test',
      ip: '127.0.0.1',
    };

    const res: MockResponse = {
      setHeader: jest.fn(),
      on: jest.fn(),
    };

    const next = jest.fn();
    middleware.use(req as Request, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      existingId,
    );
    expect(req.correlationId).toBe(existingId);
    expect(next).toHaveBeenCalled();
  });

  it('should handle missing headers and generate new ID', () => {
    const req: MockRequest = {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      url: '/api/data',
      ip: '192.168.1.100',
    };

    const res: MockResponse = {
      setHeader: jest.fn(),
      on: jest.fn(),
    };

    const next = jest.fn();
    middleware.use(req as Request, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      ),
    );

    expect(next).toHaveBeenCalled();
  });

  it('should log request start and completion', () => {
    const req: MockRequest = {
      headers: {},
      method: 'GET',
      url: '/test',
      ip: '127.0.0.1',
    };

    const res: MockResponse = {
      setHeader: jest.fn(),
      on: jest.fn(),
      statusCode: 200,
    };

    const next = jest.fn();
    middleware.use(req as Request, res as Response, next);

    // Finding the callback in mock calls
    const finishCall = res.on.mock.calls.find(
      (call: [string, () => void]) => call[0] === 'finish',
    );

    if (finishCall) {
      const [, finishCallback] = finishCall;
      finishCallback();
    }

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Incoming request: GET /test',
      'RequestCorrelationMiddleware',
      expect.objectContaining({
        correlationId: expect.any(String),
        ip: '127.0.0.1',
      }),
    );

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringMatching(/Request completed: GET \/test 200 - \d+ms/),
      'RequestCorrelationMiddleware',
      expect.objectContaining({
        correlationId: expect.any(String),
        statusCode: 200,
        duration: expect.any(Number),
      }),
    );
  });
});
