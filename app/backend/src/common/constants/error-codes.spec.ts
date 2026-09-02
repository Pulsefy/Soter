import {
  ERROR_CODES,
  API_ERROR_CODES,
  BASE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  DATABASE_ERROR_CODES,
  AUTH_ERROR_CODES,
  DOMAIN_ERROR_CODES,
  INTEGRATION_ERROR_CODES,
  ApiErrorCode,
  ErrorCode,
  ERROR_CODE_METADATA,
  getErrorCodeFromStatus,
  AppException,
} from './error-codes';

describe('Canonical API Error Code Catalog', () => {
  describe('Catalog Completeness & Integrity', () => {
    it('API_ERROR_CODES should be identical to ERROR_CODES', () => {
      expect(API_ERROR_CODES).toBe(ERROR_CODES);
    });

    it('every code in ERROR_CODES should match its key name as a stable string', () => {
      for (const [key, value] of Object.entries(ERROR_CODES)) {
        expect(value).toBe(key);
        expect(typeof value).toBe('string');
      }
    });

    it('includes all BASE_ERROR_CODES', () => {
      for (const key of Object.keys(BASE_ERROR_CODES)) {
        expect((ERROR_CODES as Record<string, string>)[key]).toBe(
          (BASE_ERROR_CODES as Record<string, string>)[key],
        );
      }
    });

    it('includes all VALIDATION_ERROR_CODES', () => {
      for (const key of Object.keys(VALIDATION_ERROR_CODES)) {
        expect((ERROR_CODES as Record<string, string>)[key]).toBe(
          (VALIDATION_ERROR_CODES as Record<string, string>)[key],
        );
      }
    });

    it('includes all DATABASE_ERROR_CODES', () => {
      for (const key of Object.keys(DATABASE_ERROR_CODES)) {
        expect((ERROR_CODES as Record<string, string>)[key]).toBe(
          (DATABASE_ERROR_CODES as Record<string, string>)[key],
        );
      }
    });

    it('includes all AUTH_ERROR_CODES', () => {
      for (const key of Object.keys(AUTH_ERROR_CODES)) {
        expect((ERROR_CODES as Record<string, string>)[key]).toBe(
          (AUTH_ERROR_CODES as Record<string, string>)[key],
        );
      }
    });

    it('includes all DOMAIN_ERROR_CODES', () => {
      for (const key of Object.keys(DOMAIN_ERROR_CODES)) {
        expect((ERROR_CODES as Record<string, string>)[key]).toBe(
          (DOMAIN_ERROR_CODES as Record<string, string>)[key],
        );
      }
    });

    it('includes all INTEGRATION_ERROR_CODES', () => {
      for (const key of Object.keys(INTEGRATION_ERROR_CODES)) {
        expect((ERROR_CODES as Record<string, string>)[key]).toBe(
          (INTEGRATION_ERROR_CODES as Record<string, string>)[key],
        );
      }
    });

    it('ApiErrorCode enum contains matching values', () => {
      expect(ApiErrorCode.BAD_REQUEST).toBe('BAD_REQUEST');
      expect(ApiErrorCode.NOT_FOUND).toBe('NOT_FOUND');
      expect(ApiErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ApiErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED');
      expect(ApiErrorCode.FORBIDDEN).toBe('FORBIDDEN');
      expect(ApiErrorCode.INTERNAL_SERVER_ERROR).toBe('INTERNAL_SERVER_ERROR');
      expect(ApiErrorCode.AI_SERVICE_UNAVAILABLE).toBe('AI_SERVICE_UNAVAILABLE');
      expect(ApiErrorCode.ONCHAIN_TRANSACTION_FAILED).toBe('ONCHAIN_TRANSACTION_FAILED');
      expect(ApiErrorCode.EVIDENCE_UPLOAD_FAILED).toBe('EVIDENCE_UPLOAD_FAILED');
      expect(ApiErrorCode.WEBHOOK_INVALID_SIGNATURE).toBe('WEBHOOK_INVALID_SIGNATURE');
    });
  });

  describe('getErrorCodeFromStatus', () => {
    it.each([
      [400, ERROR_CODES.BAD_REQUEST],
      [401, ERROR_CODES.UNAUTHORIZED],
      [403, ERROR_CODES.FORBIDDEN],
      [404, ERROR_CODES.NOT_FOUND],
      [405, ERROR_CODES.METHOD_NOT_ALLOWED],
      [409, ERROR_CODES.CONFLICT],
      [422, ERROR_CODES.VALIDATION_ERROR],
      [429, ERROR_CODES.RATE_LIMIT_EXCEEDED],
      [500, ERROR_CODES.INTERNAL_SERVER_ERROR],
      [501, ERROR_CODES.NOT_IMPLEMENTED],
      [502, ERROR_CODES.BAD_GATEWAY],
      [503, ERROR_CODES.SERVICE_UNAVAILABLE],
      [504, ERROR_CODES.GATEWAY_TIMEOUT],
    ])('maps status %i to error code %s', (status: number, expectedCode: ErrorCode) => {
      expect(getErrorCodeFromStatus(status)).toBe(expectedCode);
    });

    it('defaults unmapped status to INTERNAL_SERVER_ERROR', () => {
      expect(getErrorCodeFromStatus(418)).toBe(ERROR_CODES.INTERNAL_SERVER_ERROR);
      expect(getErrorCodeFromStatus(999)).toBe(ERROR_CODES.INTERNAL_SERVER_ERROR);
    });
  });

  describe('ERROR_CODE_METADATA', () => {
    it('has metadata entries for catalog error codes', () => {
      for (const [key, code] of Object.entries(ERROR_CODES)) {
        const meta = ERROR_CODE_METADATA[code as ErrorCode];
        expect(meta).toBeDefined();
        expect(meta.code).toBe(code);
        expect(typeof meta.httpStatus).toBe('number');
        expect(typeof meta.description).toBe('string');
        expect(meta.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('AppException with Catalog Codes', () => {
    it('instantiates correctly with catalog code and status', () => {
      const ex = new AppException(
        ERROR_CODES.AI_SERVICE_UNAVAILABLE,
        503,
        'AI service is unavailable',
        { retryAfter: 30 },
      );

      expect(ex.name).toBe('AppException');
      expect(ex.errorCode).toBe(ERROR_CODES.AI_SERVICE_UNAVAILABLE);
      expect(ex.statusCode).toBe(503);
      expect(ex.message).toBe('AI service is unavailable');
      expect(ex.details).toEqual({ retryAfter: 30 });
    });

    it('works without optional details', () => {
      const ex = new AppException(ERROR_CODES.CLAIM_NOT_FOUND, 404, 'Claim not found');

      expect(ex.errorCode).toBe(ERROR_CODES.CLAIM_NOT_FOUND);
      expect(ex.statusCode).toBe(404);
      expect(ex.details).toBeUndefined();
    });
  });
});
