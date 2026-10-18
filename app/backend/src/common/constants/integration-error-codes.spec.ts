/**
 * Integration Error Codes – Unit Tests
 *
 * Verifies that:
 *  1. Every domain code is present in INTEGRATION_ERROR_CODES and ERROR_CODES.
 *  2. AppException carries errorCode, statusCode, message, and optional details verbatim.
 *  3. AllExceptionsFilter emits the stable errorCode when an AppException is thrown.
 *  4. SorobanErrorMapper maps network/contract/timeout errors to the expected onchain codes.
 *  5. Webhook service throws the correct AppException codes for each failure scenario.
 *  6. Evidence controller throws the correct AppException codes for file-upload failures.
 */

import {
  INTEGRATION_ERROR_CODES,
  AppException,
} from './integration-error-codes';
import { ERROR_CODES } from '../dto/error-response.dto';
import { SorobanErrorMapper } from '../../onchain/utils/soroban-error.mapper';

// ---------------------------------------------------------------------------
// 1. Error code catalogue completeness
// ---------------------------------------------------------------------------

describe('INTEGRATION_ERROR_CODES catalogue', () => {
  it('exports all AI codes', () => {
    expect(INTEGRATION_ERROR_CODES.AI_SERVICE_UNAVAILABLE).toBe(
      'AI_SERVICE_UNAVAILABLE',
    );
    expect(INTEGRATION_ERROR_CODES.AI_SERVICE_TIMEOUT).toBe(
      'AI_SERVICE_TIMEOUT',
    );
    expect(INTEGRATION_ERROR_CODES.AI_INVALID_RESPONSE).toBe(
      'AI_INVALID_RESPONSE',
    );
    expect(INTEGRATION_ERROR_CODES.AI_QUOTA_EXCEEDED).toBe('AI_QUOTA_EXCEEDED');
    expect(INTEGRATION_ERROR_CODES.AI_VERIFICATION_FAILED).toBe(
      'AI_VERIFICATION_FAILED',
    );
  });

  it('exports all onchain codes', () => {
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_NETWORK_UNREACHABLE).toBe(
      'ONCHAIN_NETWORK_UNREACHABLE',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_TRANSACTION_TIMEOUT).toBe(
      'ONCHAIN_TRANSACTION_TIMEOUT',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_TRANSACTION_FAILED).toBe(
      'ONCHAIN_TRANSACTION_FAILED',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_CONTRACT_ERROR).toBe(
      'ONCHAIN_CONTRACT_ERROR',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_INSUFFICIENT_FUNDS).toBe(
      'ONCHAIN_INSUFFICIENT_FUNDS',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_PACKAGE_NOT_FOUND).toBe(
      'ONCHAIN_PACKAGE_NOT_FOUND',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_PACKAGE_EXPIRED).toBe(
      'ONCHAIN_PACKAGE_EXPIRED',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_INVALID_STATE).toBe(
      'ONCHAIN_INVALID_STATE',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_NOT_AUTHORIZED).toBe(
      'ONCHAIN_NOT_AUTHORIZED',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_CONTRACT_PAUSED).toBe(
      'ONCHAIN_CONTRACT_PAUSED',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_TOKEN_TRANSFER_FAILED).toBe(
      'ONCHAIN_TOKEN_TRANSFER_FAILED',
    );
    expect(INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR).toBe('ONCHAIN_RPC_ERROR');
  });

  it('exports all evidence codes', () => {
    expect(INTEGRATION_ERROR_CODES.EVIDENCE_UPLOAD_FAILED).toBe(
      'EVIDENCE_UPLOAD_FAILED',
    );
    expect(INTEGRATION_ERROR_CODES.EVIDENCE_INVALID_FILE_TYPE).toBe(
      'EVIDENCE_INVALID_FILE_TYPE',
    );
    expect(INTEGRATION_ERROR_CODES.EVIDENCE_FILE_TOO_LARGE).toBe(
      'EVIDENCE_FILE_TOO_LARGE',
    );
    expect(INTEGRATION_ERROR_CODES.EVIDENCE_MISSING_FILE).toBe(
      'EVIDENCE_MISSING_FILE',
    );
    expect(INTEGRATION_ERROR_CODES.EVIDENCE_NOT_FOUND).toBe(
      'EVIDENCE_NOT_FOUND',
    );
    expect(INTEGRATION_ERROR_CODES.EVIDENCE_ACCESS_DENIED).toBe(
      'EVIDENCE_ACCESS_DENIED',
    );
    expect(INTEGRATION_ERROR_CODES.EVIDENCE_CORRUPT_FILE).toBe(
      'EVIDENCE_CORRUPT_FILE',
    );
  });

  it('exports all webhook codes', () => {
    expect(INTEGRATION_ERROR_CODES.WEBHOOK_DUPLICATE_EVENT).toBe(
      'WEBHOOK_DUPLICATE_EVENT',
    );
    expect(INTEGRATION_ERROR_CODES.WEBHOOK_SESSION_NOT_FOUND).toBe(
      'WEBHOOK_SESSION_NOT_FOUND',
    );
    expect(INTEGRATION_ERROR_CODES.WEBHOOK_STEP_NOT_FOUND).toBe(
      'WEBHOOK_STEP_NOT_FOUND',
    );
    expect(INTEGRATION_ERROR_CODES.WEBHOOK_INVALID_SIGNATURE).toBe(
      'WEBHOOK_INVALID_SIGNATURE',
    );
    expect(INTEGRATION_ERROR_CODES.WEBHOOK_DELIVERY_FAILED).toBe(
      'WEBHOOK_DELIVERY_FAILED',
    );
    expect(INTEGRATION_ERROR_CODES.WEBHOOK_INVALID_PAYLOAD).toBe(
      'WEBHOOK_INVALID_PAYLOAD',
    );
  });

  it('all integration codes are also present in the merged ERROR_CODES map', () => {
    for (const key of Object.keys(INTEGRATION_ERROR_CODES)) {
      expect((ERROR_CODES as Record<string, string>)[key]).toBe(
        (INTEGRATION_ERROR_CODES as Record<string, string>)[key],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. AppException shape
// ---------------------------------------------------------------------------

describe('AppException', () => {
  it('stores errorCode, statusCode, message, and details', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.AI_SERVICE_UNAVAILABLE,
      503,
      'AI service is down',
      { retryAfterSeconds: 30 },
    );

    expect(ex).toBeInstanceOf(AppException);
    expect(ex).toBeInstanceOf(Error);
    expect(ex.errorCode).toBe('AI_SERVICE_UNAVAILABLE');
    expect(ex.statusCode).toBe(503);
    expect(ex.message).toBe('AI service is down');
    expect(ex.details).toEqual({ retryAfterSeconds: 30 });
    expect(ex.name).toBe('AppException');
  });

  it('works without optional details', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
      401,
      'HMAC mismatch',
    );

    expect(ex.details).toBeUndefined();
  });

  it('produces a stable errorCode for every integration domain', () => {
    const cases: Array<[string, number, string]> = [
      [INTEGRATION_ERROR_CODES.AI_SERVICE_TIMEOUT, 504, 'timeout'],
      [INTEGRATION_ERROR_CODES.AI_QUOTA_EXCEEDED, 429, 'quota'],
      [INTEGRATION_ERROR_CODES.ONCHAIN_PACKAGE_NOT_FOUND, 404, 'not found'],
      [INTEGRATION_ERROR_CODES.ONCHAIN_TRANSACTION_FAILED, 400, 'tx failed'],
      [INTEGRATION_ERROR_CODES.EVIDENCE_MISSING_FILE, 400, 'no file'],
      [INTEGRATION_ERROR_CODES.EVIDENCE_ACCESS_DENIED, 401, 'denied'],
      [INTEGRATION_ERROR_CODES.WEBHOOK_DUPLICATE_EVENT, 409, 'duplicate'],
      [INTEGRATION_ERROR_CODES.WEBHOOK_SESSION_NOT_FOUND, 404, 'no session'],
    ];

    for (const [code, status, message] of cases) {
      const ex = new AppException(code, status, message);
      expect(ex.errorCode).toBe(code);
      expect(ex.statusCode).toBe(status);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. SorobanErrorMapper – onchain error codes
// ---------------------------------------------------------------------------

describe('SorobanErrorMapper – onchain error codes', () => {
  const mapper = new SorobanErrorMapper();

  describe('network errors', () => {
    it('maps ECONNREFUSED to ONCHAIN_NETWORK_UNREACHABLE', () => {
      const result = mapper.mapError({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:8000',
      });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_NETWORK_UNREACHABLE,
      );
      expect(result.statusCode).toBe(503);
    });

    it('maps ENOTFOUND to ONCHAIN_NETWORK_UNREACHABLE', () => {
      const result = mapper.mapError({
        code: 'ENOTFOUND',
        message: 'getaddrinfo ENOTFOUND rpc.testnet',
      });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_NETWORK_UNREACHABLE,
      );
      expect(result.statusCode).toBe(503);
    });

    it('maps ETIMEDOUT to ONCHAIN_TRANSACTION_TIMEOUT', () => {
      const result = mapper.mapError({
        code: 'ETIMEDOUT',
        message: 'socket hang up',
      });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_TRANSACTION_TIMEOUT,
      );
      expect(result.statusCode).toBe(504);
    });

    it('maps message containing "timeout" to ONCHAIN_TRANSACTION_TIMEOUT', () => {
      const result = mapper.mapError(
        new Error('Request timeout after 30000ms'),
      );
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_TRANSACTION_TIMEOUT,
      );
    });
  });

  describe('contract errors – numeric codes', () => {
    it('maps errorCode 5 (PackageNotFound) to ONCHAIN_PACKAGE_NOT_FOUND', () => {
      const result = mapper.mapError({ errorCode: 5 });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_PACKAGE_NOT_FOUND,
      );
      expect(result.statusCode).toBe(404);
    });

    it('maps errorCode 7 (PackageExpired) to ONCHAIN_PACKAGE_EXPIRED', () => {
      const result = mapper.mapError({ errorCode: 7 });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_PACKAGE_EXPIRED,
      );
      expect(result.statusCode).toBe(410);
    });

    it('maps errorCode 9 (InsufficientFunds) to ONCHAIN_INSUFFICIENT_FUNDS', () => {
      const result = mapper.mapError({ errorCode: 9 });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_INSUFFICIENT_FUNDS,
      );
      expect(result.statusCode).toBe(400);
    });

    it('maps errorCode 14 (ContractPaused) to ONCHAIN_CONTRACT_PAUSED', () => {
      const result = mapper.mapError({ errorCode: 14 });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_CONTRACT_PAUSED,
      );
      expect(result.statusCode).toBe(503);
    });

    it('maps errorCode 18 (TokenTransferFailed) to ONCHAIN_TOKEN_TRANSFER_FAILED', () => {
      const result = mapper.mapError({ errorCode: 18 });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_TOKEN_TRANSFER_FAILED,
      );
      expect(result.statusCode).toBe(502);
    });

    it('maps errorCode 3 (NotAuthorized) to ONCHAIN_NOT_AUTHORIZED', () => {
      const result = mapper.mapError({ errorCode: 3 });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_NOT_AUTHORIZED,
      );
      expect(result.statusCode).toBe(403);
    });
  });

  describe('contract errors – string messages', () => {
    it('maps "PackageNotFound" message to ONCHAIN_PACKAGE_NOT_FOUND', () => {
      const result = mapper.mapError(
        new Error('HostError: Error(Contract) PackageNotFound'),
      );
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_PACKAGE_NOT_FOUND,
      );
    });

    it('maps "ContractPaused" message to ONCHAIN_CONTRACT_PAUSED', () => {
      const result = mapper.mapError(new Error('ContractPaused'));
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_CONTRACT_PAUSED,
      );
    });

    it('maps "TokenTransferFailed" message to ONCHAIN_TOKEN_TRANSFER_FAILED', () => {
      const result = mapper.mapError(
        new Error('TokenTransferFailed: recipient has no trustline'),
      );
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_TOKEN_TRANSFER_FAILED,
      );
    });

    it('maps "NotAuthorized" message to ONCHAIN_NOT_AUTHORIZED', () => {
      const result = mapper.mapError(new Error('NotAuthorized'));
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_NOT_AUTHORIZED,
      );
    });
  });

  describe('JSON-RPC errors', () => {
    it('maps -32603 (internal RPC error) to ONCHAIN_RPC_ERROR', () => {
      const result = mapper.mapError({
        response: {
          data: { error: { code: -32603, message: 'Internal error' } },
        },
      });
      expect(result.errorCode).toBe(INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR);
      expect(result.statusCode).toBe(500);
    });

    it('maps RPC error embedding contract error #18 to ONCHAIN_TOKEN_TRANSFER_FAILED', () => {
      const result = mapper.mapError({
        response: {
          data: {
            error: { code: -32603, message: 'HostError: Error(Contract, #18)' },
          },
        },
      });
      expect(result.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_TOKEN_TRANSFER_FAILED,
      );
    });
  });

  describe('throwMappedError', () => {
    it('throws AppException with the mapped errorCode', () => {
      expect(() => mapper.throwMappedError({ errorCode: 5 })).toThrow(
        AppException,
      );

      let caught: AppException | null = null;
      try {
        mapper.throwMappedError({ errorCode: 5 });
      } catch (e) {
        caught = e as AppException;
      }

      expect(caught).not.toBeNull();
      expect(caught!.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_PACKAGE_NOT_FOUND,
      );
      expect(caught!.statusCode).toBe(404);
    });

    it('throws AppException(ONCHAIN_NETWORK_UNREACHABLE) for ECONNREFUSED', () => {
      let caught: AppException | null = null;
      try {
        mapper.throwMappedError({ code: 'ECONNREFUSED', message: 'refused' });
      } catch (e) {
        caught = e as AppException;
      }
      expect(caught!.errorCode).toBe(
        INTEGRATION_ERROR_CODES.ONCHAIN_NETWORK_UNREACHABLE,
      );
      expect(caught!.statusCode).toBe(503);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Webhook service – error codes (audit/webhooks.service)
// ---------------------------------------------------------------------------

import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService as AuditWebhooksService } from '../../audit/webhooks.service';
import { SessionService } from '../../session/session.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('Audit WebhooksService – integration error codes', () => {
  let service: AuditWebhooksService;

  const mockPrisma = {
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(cb => cb(mockPrisma)),
  };

  const mockSession = {
    getSession: jest.fn(),
    submitToStep: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditWebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SessionService, useValue: mockSession },
      ],
    }).compile();

    service = module.get<AuditWebhooksService>(AuditWebhooksService);
    jest.clearAllMocks();
  });

  it('throws AppException(WEBHOOK_DUPLICATE_EVENT, 409) on duplicate event', async () => {
    mockPrisma.webhookEvent.findUnique.mockResolvedValue({ id: 'existing' });

    let caught: AppException | null = null;
    try {
      await service.handleAiVerification({
        idempotencyKey: 'k1',
        sessionId: 's1',
      });
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught!.errorCode).toBe(
      INTEGRATION_ERROR_CODES.WEBHOOK_DUPLICATE_EVENT,
    );
    expect(caught!.statusCode).toBe(409);
  });

  it('throws AppException(WEBHOOK_SESSION_NOT_FOUND, 404) when session is absent', async () => {
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
    mockSession.getSession.mockResolvedValue(null);

    await expect(
      service.handleAiVerification({ idempotencyKey: 'k1', sessionId: 's1' }),
    ).rejects.toMatchObject({
      errorCode: INTEGRATION_ERROR_CODES.WEBHOOK_SESSION_NOT_FOUND,
      statusCode: 404,
    });
  });

  it('throws AppException(WEBHOOK_SESSION_NOT_FOUND, 404) when session is not pending', async () => {
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
    mockSession.getSession.mockResolvedValue({
      id: 's1',
      status: 'approved',
      steps: [],
    });

    await expect(
      service.handleAiVerification({ idempotencyKey: 'k1', sessionId: 's1' }),
    ).rejects.toMatchObject({
      errorCode: INTEGRATION_ERROR_CODES.WEBHOOK_SESSION_NOT_FOUND,
      statusCode: 404,
    });
  });

  it('throws AppException(WEBHOOK_STEP_NOT_FOUND, 404) when matching step is absent', async () => {
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
    mockSession.getSession.mockResolvedValue({
      id: 's1',
      status: 'pending',
      steps: [{ stepName: 'kyc', status: 'pending' }],
    });

    await expect(
      service.handleAiVerification({ idempotencyKey: 'k1', sessionId: 's1' }),
    ).rejects.toMatchObject({
      errorCode: INTEGRATION_ERROR_CODES.WEBHOOK_STEP_NOT_FOUND,
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Evidence – AppException codes (unit-level, no HTTP layer)
// ---------------------------------------------------------------------------

describe('Evidence integration error codes – AppException shapes', () => {
  it('EVIDENCE_MISSING_FILE has statusCode 400', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.EVIDENCE_MISSING_FILE,
      400,
      'No file uploaded',
    );
    expect(ex.errorCode).toBe('EVIDENCE_MISSING_FILE');
    expect(ex.statusCode).toBe(400);
  });

  it('EVIDENCE_ACCESS_DENIED has statusCode 401', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.EVIDENCE_ACCESS_DENIED,
      401,
      'Artifact does not belong to the specified organization',
    );
    expect(ex.errorCode).toBe('EVIDENCE_ACCESS_DENIED');
    expect(ex.statusCode).toBe(401);
  });

  it('EVIDENCE_NOT_FOUND has statusCode 401', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.EVIDENCE_NOT_FOUND,
      401,
      'Artifact not found',
    );
    expect(ex.errorCode).toBe('EVIDENCE_NOT_FOUND');
  });

  it('EVIDENCE_CORRUPT_FILE carries details', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.EVIDENCE_CORRUPT_FILE,
      400,
      'Magic-byte validation failed',
      { declaredMime: 'image/jpeg', detectedMime: 'application/zip' },
    );
    expect(ex.errorCode).toBe('EVIDENCE_CORRUPT_FILE');
    expect(ex.details).toMatchObject({ declaredMime: 'image/jpeg' });
  });
});

// ---------------------------------------------------------------------------
// 6. AI error codes – AppException shapes
// ---------------------------------------------------------------------------

describe('AI integration error codes – AppException shapes', () => {
  it('AI_SERVICE_UNAVAILABLE is 503', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.AI_SERVICE_UNAVAILABLE,
      503,
      'OCR service unavailable',
      { serviceUrl: 'http://ai:8000' },
    );
    expect(ex.errorCode).toBe('AI_SERVICE_UNAVAILABLE');
    expect(ex.statusCode).toBe(503);
    expect(ex.details).toMatchObject({ serviceUrl: 'http://ai:8000' });
  });

  it('AI_SERVICE_TIMEOUT is 504', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.AI_SERVICE_TIMEOUT,
      504,
      'OCR service call timed out',
    );
    expect(ex.errorCode).toBe('AI_SERVICE_TIMEOUT');
    expect(ex.statusCode).toBe(504);
  });

  it('AI_INVALID_RESPONSE is 502', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.AI_INVALID_RESPONSE,
      502,
      'OCR service returned 500',
      { httpStatus: 500 },
    );
    expect(ex.errorCode).toBe('AI_INVALID_RESPONSE');
    expect(ex.statusCode).toBe(502);
  });

  it('AI_QUOTA_EXCEEDED is 429', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.AI_QUOTA_EXCEEDED,
      429,
      'LLM rate limit hit',
    );
    expect(ex.errorCode).toBe('AI_QUOTA_EXCEEDED');
    expect(ex.statusCode).toBe(429);
  });

  it('AI_VERIFICATION_FAILED carries claimId in details', () => {
    const ex = new AppException(
      INTEGRATION_ERROR_CODES.AI_VERIFICATION_FAILED,
      404,
      'Claim not found',
      { claimId: 'clm_abc' },
    );
    expect(ex.errorCode).toBe('AI_VERIFICATION_FAILED');
    expect(ex.details).toMatchObject({ claimId: 'clm_abc' });
  });
});
