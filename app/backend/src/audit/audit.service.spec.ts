import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaService;

  const mockPrisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: '1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('record', () => {
    it('should call prisma.auditLog.create', async () => {
      const params = {
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
        metadata: { name: 'test' },
      };
      await service.record(params);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'user-1',
          entity: 'campaign',
          entityId: 'c-1',
          action: 'create',
          metadata: { name: 'test' },
        },
      });
    });
  });

  describe('findLogs', () => {
    it('should call prisma.auditLog.findMany', async () => {
      const query = { entity: 'campaign' };
      await service.findLogs(query);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.findMany).toHaveBeenCalled();
    });
  });
});
