/**
 * JobStatusGateway – Authentication & Authorization Tests
 *
 * Covers the acceptance criteria from issue #942:
 *  1. Connections without a valid token are rejected during the handshake
 *  2. A client may only subscribe to jobs belonging to its own organization
 *  3. Token expiry during a live connection terminates the socket
 *  4. Valid, correctly-scoped subscriptions work end-to-end
 */

import { Test, TestingModule } from '@nestjs/testing';
import { WsException } from '@nestjs/websockets';
import { createHash } from 'node:crypto';

import { JobStatusGateway } from '../gateways/job-status.gateway';
import { JobStatusBroadcaster } from '../services/job-status-broadcaster.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AppRole } from '../../auth/app-role.enum';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiKeyRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'key_1',
    key: 'plaintext-key',
    keyHash: createHash('sha256').update('plaintext-key').digest('hex'),
    revokedAt: null,
    expiresAt: null,
    graceExpiresAt: null,
    replacedById: null,
    role: AppRole.ngo,
    orgId: 'org_abc',
    ngoId: null,
    ...overrides,
  };
}

function makeSocket(authCtx?: Record<string, unknown>) {
  const socket: any = {
    id: 'socket_1',
    auth: authCtx,
    subscriptions: new Map(),
    redisSub: {
      subscribe: jest.fn((_ch: string, cb: (err: null) => void) => cb(null)),
      unsubscribe: jest.fn(),
      on: jest.fn(),
      disconnect: jest.fn(),
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: {
      auth: {},
      headers: {},
    },
  };
  return socket;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JobStatusGateway', () => {
  let gateway: JobStatusGateway;
  let mockPrisma: { apiKey: { findFirst: jest.Mock } };
  let mockRedis: any;
  let mockBroadcaster: Partial<JobStatusBroadcaster>;

  beforeEach(async () => {
    mockPrisma = {
      apiKey: {
        findFirst: jest.fn(),
      },
    };

    mockRedis = {
      publish: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn().mockReturnValue({
        lpush: jest.fn().mockReturnThis(),
        ltrim: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      lrange: jest.fn().mockResolvedValue([]),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      hlen: jest.fn().mockResolvedValue(0),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
      llen: jest.fn().mockResolvedValue(0),
      duplicate: jest.fn().mockReturnThis(),
      disconnect: jest.fn(),
      subscribe: jest.fn((_ch: string, cb: (err: null) => void) => cb(null)),
      unsubscribe: jest.fn(),
      on: jest.fn(),
    };

    mockBroadcaster = {
      broadcastJobStatus: jest.fn().mockResolvedValue(undefined),
      recordSubscription: jest.fn().mockResolvedValue(undefined),
      removeSubscription: jest.fn().mockResolvedValue(undefined),
      getJobHistory: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobStatusGateway,
        { provide: JobStatusBroadcaster, useValue: mockBroadcaster },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    gateway = module.get<JobStatusGateway>(JobStatusGateway);
  });

  // =========================================================================
  // 1.  Handshake / connection-level authentication
  // =========================================================================

  describe('validateApiKey (handshake auth)', () => {
    it('should return null when no record exists in the database', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValue(null);

      const result = await gateway.validateApiKey('bad-key');

      expect(result).toBeNull();
    });

    it('should return null when the API key is expired', async () => {
      const expiredRecord = makeApiKeyRecord({
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      });
      mockPrisma.apiKey.findFirst.mockResolvedValue(expiredRecord);

      const result = await gateway.validateApiKey('plaintext-key');

      expect(result).toBeNull();
    });

    it('should return null when the API key has been revoked', async () => {
      // The guard now fetches the record regardless of revokedAt,
      // then checks the lifecycle state explicitly.
      const revokedRecord = makeApiKeyRecord({
        revokedAt: new Date(Date.now() - 1000), // revoked 1 second ago
      });
      mockPrisma.apiKey.findFirst.mockResolvedValue(revokedRecord);

      const result = await gateway.validateApiKey('revoked-key');

      expect(result).toBeNull();
    });

    it('should return null when the key grace period has ended after rotation', async () => {
      const rotatedRecord = makeApiKeyRecord({
        graceExpiresAt: new Date(Date.now() - 1000), // grace expired 1 second ago
        replacedById: 'key_2',
      });
      mockPrisma.apiKey.findFirst.mockResolvedValue(rotatedRecord);

      const result = await gateway.validateApiKey('old-key');

      expect(result).toBeNull();
    });

    it('should return an auth context for a rotated key still within its grace window', async () => {
      const graceRecord = makeApiKeyRecord({
        graceExpiresAt: new Date(Date.now() + 3600_000), // grace still active
        replacedById: 'key_2',
      });
      mockPrisma.apiKey.findFirst.mockResolvedValue(graceRecord);

      const result = await gateway.validateApiKey('old-key-in-grace');

      expect(result).not.toBeNull();
    });

    it('should return an auth context for a valid, non-expired key', async () => {
      const record = makeApiKeyRecord({
        expiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
      });
      mockPrisma.apiKey.findFirst.mockResolvedValue(record);

      const result = await gateway.validateApiKey('plaintext-key');

      expect(result).not.toBeNull();
      expect(result?.apiKeyId).toBe('key_1');
      expect(result?.orgId).toBe('org_abc');
      expect(result?.role).toBe(AppRole.ngo);
    });

    it('should return an auth context for a valid key with no expiry', async () => {
      const record = makeApiKeyRecord({ expiresAt: null });
      mockPrisma.apiKey.findFirst.mockResolvedValue(record);

      const result = await gateway.validateApiKey('plaintext-key');

      expect(result).not.toBeNull();
      expect(result?.expiresAt).toBeUndefined();
    });

    it('should hash the key and query by both keyHash and plaintext', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValue(
        makeApiKeyRecord({ expiresAt: null }),
      );

      await gateway.validateApiKey('plaintext-key');

      const expectedHash = createHash('sha256')
        .update('plaintext-key')
        .digest('hex');
      expect(mockPrisma.apiKey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { keyHash: expectedHash },
              { key: 'plaintext-key' },
            ]),
          }),
        }),
      );
      // revokedAt is NOT filtered in the WHERE clause — lifecycle state
      // is checked after retrieval so each failure mode is distinguishable.
      const callArg = mockPrisma.apiKey.findFirst.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('revokedAt');
    });
  });

  // =========================================================================
  // 2. handleSubscribe – per-org authorization
  // =========================================================================

  describe('handleSubscribe', () => {
    it('should throw WsException when subscribing to a different org', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        ngoId: null,
        role: AppRole.ngo,
      });

      await expect(
        gateway.handleSubscribe(socket, {
          jobId: 'job_1',
          orgId: 'org_xyz', // different org
        }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when socket has no auth context', async () => {
      const socket = makeSocket(undefined); // no auth

      await expect(
        gateway.handleSubscribe(socket, {
          jobId: 'job_1',
          orgId: 'org_abc',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should allow subscription when orgId matches', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        ngoId: null,
        role: AppRole.ngo,
      });

      await gateway.handleSubscribe(socket, {
        jobId: 'job_1',
        orgId: 'org_abc', // same org
      });

      expect(mockBroadcaster.recordSubscription).toHaveBeenCalledWith(
        'job_1',
        expect.any(String),
        'key_1',
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'subscribed',
        expect.objectContaining({ jobId: 'job_1' }),
      );
    });

    it('should allow subscription without orgId in payload (non-org-scoped job)', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        ngoId: null,
        role: AppRole.ngo,
      });

      await gateway.handleSubscribe(socket, { jobId: 'job_1' });

      expect(socket.emit).toHaveBeenCalledWith(
        'subscribed',
        expect.objectContaining({ jobId: 'job_1' }),
      );
    });

    it('should allow admin to subscribe to any org job', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_admin',
        orgId: null,
        ngoId: null,
        role: AppRole.admin,
      });

      await gateway.handleSubscribe(socket, {
        jobId: 'job_1',
        orgId: 'org_xyz', // different org — admin should still be allowed
      });

      expect(socket.emit).toHaveBeenCalledWith(
        'subscribed',
        expect.objectContaining({ jobId: 'job_1' }),
      );
    });

    it('should throw WsException for invalid jobId', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        ngoId: null,
        role: AppRole.ngo,
      });

      await expect(
        gateway.handleSubscribe(socket, { jobId: '' }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when key has no org but orgId is requested', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: undefined, // key not scoped to any org
        ngoId: undefined,
        role: AppRole.ngo,
      });

      await expect(
        gateway.handleSubscribe(socket, {
          jobId: 'job_1',
          orgId: 'org_abc',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should emit subscribed event with missed updates when history exists', async () => {
      const historicalEvent = {
        eventId: 'evt_1',
        job: {
          id: 'job_1',
          type: 'ocr',
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        emittedAt: new Date(),
        isTerminal: true,
      };

      (mockBroadcaster.getJobHistory as jest.Mock).mockResolvedValue([
        historicalEvent,
      ]);

      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        ngoId: null,
        role: AppRole.ngo,
      });

      await gateway.handleSubscribe(socket, {
        jobId: 'job_1',
        orgId: 'org_abc',
        options: { sendMissedUpdates: true },
      });

      expect(socket.emit).toHaveBeenCalledWith(
        'subscribed',
        expect.objectContaining({
          missedUpdatesCount: 1,
          missedUpdates: expect.arrayContaining([historicalEvent]),
        }),
      );
    });
  });

  // =========================================================================
  // 3. Token expiry terminates live connections
  // =========================================================================

  describe('disconnectExpiredSockets', () => {
    it('should disconnect sockets whose API key has expired', async () => {
      const expiredSocket = makeSocket({
        apiKeyId: 'key_expired',
        orgId: 'org_abc',
        role: AppRole.ngo,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
      });

      // Attach a mock server with fetchSockets
      (gateway as any).server = {
        fetchSockets: jest.fn().mockResolvedValue([expiredSocket]),
      };

      await (gateway as any).disconnectExpiredSockets();

      expect(expiredSocket.emit).toHaveBeenCalledWith('error', {
        message: 'API key expired',
      });
      expect(expiredSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it('should NOT disconnect sockets whose key has not expired yet', async () => {
      const validSocket = makeSocket({
        apiKeyId: 'key_valid',
        orgId: 'org_abc',
        role: AppRole.ngo,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour away
      });

      (gateway as any).server = {
        fetchSockets: jest.fn().mockResolvedValue([validSocket]),
      };

      await (gateway as any).disconnectExpiredSockets();

      expect(validSocket.disconnect).not.toHaveBeenCalled();
    });

    it('should NOT disconnect sockets with no expiry on their key', async () => {
      const neverExpiresSocket = makeSocket({
        apiKeyId: 'key_permanent',
        orgId: 'org_abc',
        role: AppRole.ngo,
        // expiresAt is absent — key never expires
      });

      (gateway as any).server = {
        fetchSockets: jest.fn().mockResolvedValue([neverExpiresSocket]),
      };

      await (gateway as any).disconnectExpiredSockets();

      expect(neverExpiresSocket.disconnect).not.toHaveBeenCalled();
    });

    it('should do nothing when the server is not initialized', async () => {
      (gateway as any).server = undefined;

      // Should not throw
      await expect(
        (gateway as any).disconnectExpiredSockets(),
      ).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // 4. handleConnection / handleDisconnect lifecycle
  // =========================================================================

  describe('handleConnection', () => {
    it('should initialize subscriptions and emit connected event', () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        role: AppRole.ngo,
      });

      gateway.handleConnection(socket);

      expect(socket.subscriptions).toBeInstanceOf(Map);
      expect(socket.emit).toHaveBeenCalledWith(
        'connected',
        expect.objectContaining({ socketId: socket.id }),
      );
    });
  });

  describe('handleDisconnect', () => {
    it('should clean up subscriptions and disconnect Redis on disconnect', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        role: AppRole.ngo,
      });

      socket.subscriptions = new Map([
        [
          'job_1',
          {
            subscriptionId: 'sub_1',
            jobId: 'job_1',
            options: {},
            subscribedAt: new Date(),
          },
        ],
      ]);

      await gateway.handleDisconnect(socket);

      expect(mockBroadcaster.removeSubscription).toHaveBeenCalledWith(
        'job_1',
        'sub_1',
      );
      expect(socket.redisSub.disconnect).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. handleUnsubscribe
  // =========================================================================

  describe('handleUnsubscribe', () => {
    it('should remove subscription and emit unsubscribed event', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        role: AppRole.ngo,
      });

      socket.subscriptions = new Map([
        [
          'job_1',
          {
            subscriptionId: 'sub_1',
            jobId: 'job_1',
            options: {},
            subscribedAt: new Date(),
          },
        ],
      ]);

      await gateway.handleUnsubscribe(socket, { jobId: 'job_1' });

      expect(mockBroadcaster.removeSubscription).toHaveBeenCalledWith(
        'job_1',
        'sub_1',
      );
      expect(socket.emit).toHaveBeenCalledWith('unsubscribed', {
        jobId: 'job_1',
      });
    });

    it('should throw WsException for missing jobId', async () => {
      const socket = makeSocket({
        apiKeyId: 'key_1',
        orgId: 'org_abc',
        role: AppRole.ngo,
      });

      await expect(gateway.handleUnsubscribe(socket, {})).rejects.toThrow(
        WsException,
      );
    });
  });

  // =========================================================================
  // 6. handlePing
  // =========================================================================

  describe('handlePing', () => {
    it('should emit pong response', () => {
      const socket = makeSocket();

      gateway.handlePing(socket);

      expect(socket.emit).toHaveBeenCalledWith(
        'pong',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });
  });
});
