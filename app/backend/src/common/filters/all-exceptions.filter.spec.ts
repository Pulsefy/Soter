import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter, ErrorResponse } from './http-exception.filter';
import { LoggerService } from '../../logger/logger.service';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: jest.Mocked<ArgumentsHost>;

  beforeEach(() => {
    mockLogger = {
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/api/v1/test',
      headers: { 'x-request-id': 'test-trace-id-123' },
      method: 'GET',
    };

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as any;

    filter = new AllExceptionsFilter(mockLogger);
  });

  describe('ErrorResponse shape', () => {
    it('should always include code, message, timestamp, and path', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');
      expect(typeof body.code).toBe('number');
      expect(typeof body.message).toBe('string');
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.path).toBe('string');
    });

    it('should include traceId from x-request-id header', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.traceId).toBe('test-trace-id-123');
    });

    it('should have undefined traceId when x-request-id header is absent', () => {
      mockRequest.headers = {};
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.traceId).toBeUndefined();
    });
  });

  describe('HttpException handling', () => {
    it('should handle BadRequestException (400)', () => {
      const exception = new HttpException(
        'Bad request',
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(400);
      expect(body.message).toBe('Bad request');
    });

    it('should handle NotFoundException (404)', () => {
      const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(404);
    });

    it('should handle UnauthorizedException (401)', () => {
      const exception = new HttpException(
        'Unauthorized',
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(401);
      expect(body.message).toBe('Unauthorized');
    });

    it('should handle ForbiddenException (403)', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(403);
    });

    it('should handle InternalServerErrorException (500)', () => {
      const exception = new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(500);
    });

    it('should extract message from object response', () => {
      const exception = new HttpException(
        { statusCode: 400, message: 'Validation failed', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(400);
      expect(body.message).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.objectContaining({
          statusCode: 400,
          message: 'Validation failed',
        }),
      );
    });
  });

  describe('Prisma error handling', () => {
    it('should handle P2002 (unique constraint) as 409 Conflict', () => {
      const prismaError = new Error('Database error');
      Object.assign(prismaError, {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(409);
      expect(body.message).toBe('Unique constraint violation');
      expect(body.details).toEqual({
        target: ['email'],
        field: 'email',
      });
    });

    it('should handle P2025 (record not found) as 404', () => {
      const prismaError = new Error('Record not found');
      Object.assign(prismaError, {
        code: 'P2025',
        clientVersion: '5.0.0',
        meta: { cause: 'Record to update not found.' },
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(404);
      expect(body.message).toBe('Record not found');
    });

    it('should handle P2003 (foreign key constraint) as 400', () => {
      const prismaError = new Error('Foreign key fail');
      Object.assign(prismaError, {
        code: 'P2003',
        clientVersion: '5.0.0',
        meta: { field_name: 'userId' },
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(400);
      expect(body.message).toBe('Foreign key constraint violation');
    });

    it('should handle P2000 (value too long) as 400', () => {
      const prismaError = new Error('Value too long');
      Object.assign(prismaError, {
        code: 'P2000',
        clientVersion: '5.0.0',
        meta: { column_name: 'name' },
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(400);
      expect(body.message).toBe('Value too long for column');
    });

    it('should handle unknown Prisma errors as 500', () => {
      const prismaError = new Error('Unknown DB error');
      Object.assign(prismaError, {
        code: 'P9999',
        clientVersion: '5.0.0',
        meta: { something: 'unexpected' },
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(500);
      expect(body.details).toEqual({
        code: 'P9999',
        meta: { something: 'unexpected' },
      });
    });
  });

  describe('Generic error handling', () => {
    it('should handle generic Error as 500', () => {
      const exception = new Error('Something went wrong');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe(500);
      expect(body.message).toBe('Something went wrong');
      expect(body.details).toEqual(
        expect.objectContaining({ error_type: 'Error' }),
      );
    });

    it('should default message to "Internal server error" when missing', () => {
      const exception = { constructor: { name: 'CustomError' } };

      filter.catch(exception, mockHost);

      const body: ErrorResponse = mockResponse.json.mock.calls[0][0];
      expect(body.message).toBe('Internal server error');
    });
  });

  describe('Logging', () => {
    it('should log the error with trace ID and path', () => {
      const exception = new Error('Logged error');

      filter.catch(exception, mockHost);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('test-trace-id-123'),
        expect.any(String),
        'AllExceptionsFilter',
      );
    });

    it('should log "N/A" when no trace ID is present', () => {
      mockRequest.headers = {};
      const exception = new Error('No trace');

      filter.catch(exception, mockHost);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('N/A'),
        expect.any(String),
        'AllExceptionsFilter',
      );
    });
  });
});
