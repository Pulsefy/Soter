import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiKeysService,
  deriveRotationStatus,
  DEFAULT_API_KEY_REMINDER_WINDOW_DAYS,
} from './api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppRole } from '../auth/app-role.enum';
import { ApiKeyScope } from './api-key-scope.enum';

describe('deriveRotationStatus', () => {
  const base = {
    id: 'k1',
    role: AppRole.operator,
    scopes: [ApiKeyScope.read],
    revokedAt: null as Date | null,
    revokedReason: null as string | null,
    replacedById: null as string | null,
    expiresAt: null as Date | null,
  };

  it('marks rotated keys', () => {
    const result = deriveRotationStatus({
      ...base,
      revokedAt: new Date(),
      revokedReason: 'rotated',
      replacedById: 'k2',
    });
    expect(result.rotationStatus).toBe('rotated');
    expect(result.rotationGuidance).toBeNull();
  });

  it('marks predecessors inside the rotation grace window as grace', () => {
    const result = deriveRotationStatus({
      ...base,
      revokedReason: 'rotated',
      replacedById: 'k2',
      graceExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(result.rotationStatus).toBe('grace');
    expect(result.daysUntilExpiry).toBeGreaterThan(0);
    expect(result.rotationGuidance).toMatch(/overlap window/);
  });

  it('falls back to rotated status once the grace window has passed', () => {
    const result = deriveRotationStatus({
      ...base,
      revokedReason: 'rotated',
      replacedById: 'k2',
      graceExpiresAt: new Date(Date.now() - 1000),
    });
    expect(result.rotationStatus).toBe('rotated');
  });

  it('marks revoked keys', () => {
    const result = deriveRotationStatus({
      ...base,
      revokedAt: new Date(),
      revokedReason: 'compromised',
    });
    expect(result.rotationStatus).toBe('revoked');
  });

  it('marks expired keys and guides high-risk rotation', () => {
    const result = deriveRotationStatus({
      ...base,
      role: AppRole.admin,
      scopes: [ApiKeyScope.admin],
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(result.rotationStatus).toBe('expired');
    expect(result.isHighRisk).toBe(true);
    expect(result.rotationGuidance).toMatch(/Rotate immediately/);
  });

  it('marks expiring_soon within reminder window', () => {
    const result = deriveRotationStatus(
      {
        ...base,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
      { reminderWindowDays: DEFAULT_API_KEY_REMINDER_WINDOW_DAYS },
    );
    expect(result.rotationStatus).toBe('expiring_soon');
    expect(result.daysUntilExpiry).toBeGreaterThan(0);
    expect(result.rotationGuidance).toMatch(/expires in/);
  });

  it('keeps active status outside reminder window', () => {
    const result = deriveRotationStatus({
      ...base,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });
    expect(result.rotationStatus).toBe('active');
    expect(result.daysUntilExpiry).toBeGreaterThan(
      DEFAULT_API_KEY_REMINDER_WINDOW_DAYS,
    );
  });
});

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  const mockPrisma = {
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue(undefined),
  };

  const mockAudit = {
    record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  const baseRow = {
    id: 'k1',
    role: AppRole.operator,
    scopes: '["admin"]',
    ngoId: null,
    description: 'test',
    createdAt: new Date(),
    lastUsedAt: null,
    createdBy: 'env:API_KEY',
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
    replacedById: null,
    keyPreview: 's2s_ab...cdef',
    expiresAt: null,
    graceExpiresAt: null,
    lastRemindedAt: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  it('creates a key and returns raw apiKey once', async () => {
    mockPrisma.apiKey.create.mockResolvedValue({ ...baseRow });

    const result = await service.create(
      { role: AppRole.operator, description: 'test' },
      { authType: 'envApiKey' },
    );

    expect(result.id).toBe('k1');
    expect(result.apiKey).toMatch(/^s2s_/);
    expect(result.scopes).toEqual([ApiKeyScope.admin]);
    expect(result.rotationStatus).toBe('active');
    expect(result.isHighRisk).toBe(true);
    expect(result.expiresAt).toBeNull();
  });

  it('persists optional expiresInDays metadata', async () => {
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    mockPrisma.apiKey.create.mockResolvedValue({
      ...baseRow,
      expiresAt,
    });

    const result = await service.create(
      { role: AppRole.operator, expiresInDays: 90 },
      { authType: 'envApiKey' },
    );

    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      }),
    );
    expect(result.expiresAt).toEqual(expiresAt);
    expect(result.daysUntilExpiry).not.toBeNull();
  });

  it('rejects expiresAt and expiresInDays together', async () => {
    await expect(
      service.create({
        role: AppRole.operator,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        expiresInDays: 30,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects past expiresAt', async () => {
    await expect(
      service.create({
        role: AppRole.operator,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a key with custom scopes', async () => {
    mockPrisma.apiKey.create.mockResolvedValue({
      ...baseRow,
      id: 'k2',
      scopes: '["read","write"]',
      description: 'read-write key',
      keyPreview: 's2s_cd...ghij',
    });

    const result = await service.create(
      {
        role: AppRole.operator,
        scopes: [ApiKeyScope.read, ApiKeyScope.write],
        description: 'read-write key',
      },
      { authType: 'envApiKey' },
    );

    expect(result.id).toBe('k2');
    expect(result.scopes).toEqual([ApiKeyScope.read, ApiKeyScope.write]);
    expect(result.isHighRisk).toBe(false);
    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scopes: '["read","write"]',
        }),
      }),
    );
  });

  it('requires ngoId for NGO role', async () => {
    await expect(service.create({ role: AppRole.ngo }, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lists keys without returning raw secrets and includes rotation status', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([
      {
        ...baseRow,
        keyPreview: 's2s_12...abcd',
        role: AppRole.admin,
        scopes: '["admin"]',
      },
    ]);

    const result = await service.list();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'k1',
      keyPreview: 's2s_12...abcd',
      role: AppRole.admin,
      scopes: [ApiKeyScope.admin],
      rotationStatus: 'active',
      isHighRisk: true,
    });
    expect((result[0] as any).apiKey).toBeUndefined();
    expect((result[0] as any).keyHash).toBeUndefined();
  });

  it('lists keys with custom scopes', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([
      {
        ...baseRow,
        id: 'k2',
        keyPreview: 's2s_cd...ghij',
        role: AppRole.operator,
        scopes: '["read"]',
      },
    ]);

    const result = await service.list();
    expect(result[0].scopes).toEqual([ApiKeyScope.read]);
    expect(result[0].rotationStatus).toBe('active');
  });

  describe('revoke', () => {
    it('throws NotFound if id missing', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue(null);
      await expect(service.revoke('missing', undefined, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates revocation metadata and writes an audit entry', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'k1',
        revokedAt: null,
        keyPreview: 's2s_ab...cdef',
      });
      mockPrisma.apiKey.update.mockResolvedValue({
        ...baseRow,
        revokedAt: new Date(),
        revokedReason: 'compromised',
        scopes: '["admin"]',
      });

      const result = await service.revoke('k1', 'compromised', {
        apiKeyId: 'actor-1',
      });

      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'k1' },
          data: expect.objectContaining({
            revokedAt: expect.any(Date),
            revokedBy: 'actor-1',
            revokedReason: 'compromised',
            graceExpiresAt: null,
          }),
        }),
      );
      expect(result.rotationStatus).toBe('revoked');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          entity: 'ApiKey',
          entityId: 'k1',
          action: 'api_key_revoked',
          metadata: expect.objectContaining({ reason: 'compromised' }),
        }),
      );
    });
  });

  describe('rotate', () => {
    it('throws NotFound if key missing', async () => {
      mockPrisma.$transaction.mockImplementation((fn: any) =>
        fn({
          apiKey: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(service.rotate('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects rotation of revoked keys', async () => {
      mockPrisma.$transaction.mockImplementation((fn: any) =>
        fn({
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'k1',
              role: AppRole.admin,
              ngoId: null,
              description: null,
              scopes: '["admin"]',
              revokedAt: new Date(),
              expiresAt: null,
            }),
          },
        }),
      );

      await expect(service.rotate('k1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a replacement and keeps the old key valid during the grace window', async () => {
      const tx = {
        apiKey: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'old',
            role: AppRole.operator,
            ngoId: null,
            description: 'worker',
            scopes: '["read","write"]',
            keyPreview: 's2s_old...key1',
            revokedAt: null,
            expiresAt: null,
          }),
          create: jest.fn().mockResolvedValue({
            ...baseRow,
            id: 'new',
            role: AppRole.operator,
            description: 'worker',
            scopes: '["read","write"]',
            createdBy: 'actor-1',
            keyPreview: 's2s_xx...yyyy',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const result = await service.rotate('old', { apiKeyId: 'actor-1' });

      expect(result.replacement.id).toBe('new');
      expect(result.apiKey).toMatch(/^s2s_/);
      expect(result.replacement.scopes).toEqual([
        ApiKeyScope.read,
        ApiKeyScope.write,
      ]);
      expect(result.replacement.rotationStatus).toBe('active');
      expect(tx.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old' },
          data: expect.objectContaining({
            revokedReason: 'rotated',
            replacedById: 'new',
            graceExpiresAt: expect.any(Date),
          }),
        }),
      );
      // Predecessor is not hard-revoked during the overlap window.
      const updateData = tx.apiKey.update.mock.calls[0][0].data;
      expect(updateData.revokedAt).toBeUndefined();
      expect((updateData.graceExpiresAt as Date).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(result.predecessor).toMatchObject({
        id: 'old',
        validUntil: updateData.graceExpiresAt,
      });
    });

    it('writes an audit entry for rotation', async () => {
      const tx = {
        apiKey: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'old',
            role: AppRole.operator,
            ngoId: null,
            description: null,
            scopes: '["read"]',
            keyPreview: 's2s_old...key1',
            revokedAt: null,
            expiresAt: null,
          }),
          create: jest.fn().mockResolvedValue({ ...baseRow, id: 'new' }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.rotate('old', { apiKeyId: 'actor-1' });

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          entity: 'ApiKey',
          entityId: 'old',
          action: 'api_key_rotated',
          metadata: expect.objectContaining({ replacedById: 'new' }),
        }),
      );
    });

    it('honours a custom gracePeriodHours for the overlap window', async () => {
      const tx = {
        apiKey: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'old',
            role: AppRole.operator,
            ngoId: null,
            description: null,
            scopes: '["read"]',
            keyPreview: 's2s_old...key1',
            revokedAt: null,
            expiresAt: null,
          }),
          create: jest.fn().mockResolvedValue({ ...baseRow, id: 'new' }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.rotate(
        'old',
        { apiKeyId: 'actor-1' },
        { gracePeriodHours: 48 },
      );

      const data = tx.apiKey.update.mock.calls[0][0].data;
      const expectedMin = Date.now() + 47.9 * 60 * 60 * 1000;
      expect((data.graceExpiresAt as Date).getTime()).toBeGreaterThan(
        expectedMin,
      );
    });

    it('inherits previous expiresAt when rotate dto omits expiry', async () => {
      const previousExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const tx = {
        apiKey: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'old',
            role: AppRole.admin,
            ngoId: null,
            description: 'admin',
            scopes: '["admin"]',
            revokedAt: null,
            expiresAt: previousExpiry,
          }),
          create: jest.fn().mockResolvedValue({
            ...baseRow,
            id: 'new',
            role: AppRole.admin,
            scopes: '["admin"]',
            expiresAt: previousExpiry,
            keyPreview: 's2s_new...key',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.rotate('old', { apiKeyId: 'actor-1' });

      expect(tx.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: previousExpiry,
          }),
        }),
      );
    });

    it('preserves scopes on rotation', async () => {
      const tx = {
        apiKey: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'read-key',
            role: AppRole.client,
            ngoId: null,
            description: 'read-only',
            scopes: '["read"]',
            revokedAt: null,
            expiresAt: null,
          }),
          create: jest.fn().mockResolvedValue({
            ...baseRow,
            id: 'new-read-key',
            role: AppRole.client,
            description: 'read-only',
            scopes: '["read"]',
            createdBy: 'actor-1',
            keyPreview: 's2s_new...read',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const result = await service.rotate('read-key', { apiKeyId: 'actor-1' });

      expect(result.replacement.scopes).toEqual([ApiKeyScope.read]);
      expect(tx.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scopes: '["read"]',
          }),
        }),
      );
    });
  });

  describe('surfaceUpcomingExpirations', () => {
    it('logs audit reminders and updates lastRemindedAt', async () => {
      const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      mockPrisma.apiKey.findMany.mockResolvedValue([
        {
          ...baseRow,
          id: 'expiring',
          role: AppRole.admin,
          scopes: '["admin"]',
          keyPreview: 's2s_hi...risk',
          expiresAt,
          lastRemindedAt: null,
        },
      ]);
      mockPrisma.apiKey.update.mockResolvedValue({});

      const reminders = await service.surfaceUpcomingExpirations();

      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toMatchObject({
        id: 'expiring',
        isHighRisk: true,
        keyPreview: 's2s_hi...risk',
      });
      expect(reminders[0].rotationGuidance).toMatch(/Rotate/);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'ApiKey',
          entityId: 'expiring',
          action: 'expiry_reminder',
        }),
      );
      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'expiring' },
          data: { lastRemindedAt: expect.any(Date) },
        }),
      );
    });
  });
});
