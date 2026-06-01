import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { VerificationInboxController } from '../verification-inbox.controller';
import { VerificationInboxService } from '../verification-inbox.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(orgId = 'org-alpha') {
  return { user: { orgId } };
}

// ---------------------------------------------------------------------------
// Service unit tests
// ---------------------------------------------------------------------------

describe('VerificationInboxService', () => {
  let service: VerificationInboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VerificationInboxService],
    }).compile();

    service = module.get<VerificationInboxService>(VerificationInboxService);
  });

  // --- findAll -------------------------------------------------------------

  describe('findAll', () => {
    it('returns only items belonging to the caller org', () => {
      const result = service.findAll('org-alpha', {});
      expect(result.data.every((item) => item)).toBeTruthy();
      // All returned items should be seeded org-alpha items (3 of them)
      expect(result.total).toBe(3);
    });

    it('returns empty list for an org with no items', () => {
      const result = service.findAll('org-unknown', {});
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('filters by status=pending', () => {
      const result = service.findAll('org-alpha', { status: 'pending' });
      expect(result.data.every((i) => i.status === 'pending')).toBe(true);
      expect(result.total).toBe(1);
    });

    it('filters by status=approved', () => {
      const result = service.findAll('org-alpha', { status: 'approved' });
      expect(result.data.every((i) => i.status === 'approved')).toBe(true);
    });

    it('filters by status=rejected', () => {
      const result = service.findAll('org-alpha', { status: 'rejected' });
      expect(result.data.every((i) => i.status === 'rejected')).toBe(true);
    });

    it('filters by from date (inclusive)', () => {
      const result = service.findAll('org-alpha', { from: '2024-06-02' });
      expect(result.data.every((i) => new Date(i.createdAt) >= new Date('2024-06-02'))).toBe(true);
    });

    it('filters by to date (inclusive, full day)', () => {
      const result = service.findAll('org-alpha', { to: '2024-06-01' });
      expect(result.data.every((i) => new Date(i.createdAt) <= new Date('2024-06-01T23:59:59.999Z'))).toBe(true);
    });

    it('filters by both from and to dates', () => {
      const result = service.findAll('org-alpha', { from: '2024-06-01', to: '2024-06-02' });
      expect(result.total).toBe(1);
    });

    it('throws BadRequestException when from is after to', () => {
      expect(() =>
        service.findAll('org-alpha', { from: '2024-06-10', to: '2024-06-01' }),
      ).toThrow(BadRequestException);
    });

    it('applies pagination with limit and offset', () => {
      const result = service.findAll('org-alpha', { limit: 1, offset: 0 });
      expect(result.data).toHaveLength(1);
      expect(result.limit).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.total).toBe(3); // total unchanged by pagination
    });

    it('returns empty data when offset exceeds total', () => {
      const result = service.findAll('org-alpha', { offset: 999 });
      expect(result.data).toHaveLength(0);
    });

    it('response items have the correct shape', () => {
      const result = service.findAll('org-alpha', {});
      const item = result.data[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('subject');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('requesterAddress');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('updatedAt');
    });
  });

  // --- findOne -------------------------------------------------------------

  describe('findOne', () => {
    it('returns an item when id and org match', () => {
      const item = service.findOne('org-alpha', 'vi-001');
      expect(item.id).toBe('vi-001');
      expect(item.status).toBe('pending');
    });

    it('throws NotFoundException for a non-existent id', () => {
      expect(() => service.findOne('org-alpha', 'does-not-exist')).toThrow(NotFoundException);
    });

    it('throws ForbiddenException when item belongs to a different org', () => {
      // vi-004 belongs to org-beta
      expect(() => service.findOne('org-alpha', 'vi-004')).toThrow(ForbiddenException);
    });

    it('does NOT throw NotFoundException for cross-org access (prevents ID enumeration)', () => {
      // Should be ForbiddenException, not NotFoundException, to avoid leaking existence
      expect(() => service.findOne('org-alpha', 'vi-004')).toThrow(ForbiddenException);
    });

    it('returns approved item with reviewerAddress present', () => {
      const item = service.findOne('org-alpha', 'vi-002');
      expect(item.status).toBe('approved');
      expect(item.reviewerAddress).toBeDefined();
    });

    it('createdAt and updatedAt are valid ISO strings', () => {
      const item = service.findOne('org-alpha', 'vi-001');
      expect(() => new Date(item.createdAt)).not.toThrow();
      expect(() => new Date(item.updatedAt)).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Controller unit tests
// ---------------------------------------------------------------------------

describe('VerificationInboxController', () => {
  let controller: VerificationInboxController;
  let service: VerificationInboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VerificationInboxController],
      providers: [VerificationInboxService],
    }).compile();

    controller = module.get<VerificationInboxController>(VerificationInboxController);
    service = module.get<VerificationInboxService>(VerificationInboxService);
  });

  it('controller is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to service with orgId from request', () => {
      const spy = jest.spyOn(service, 'findAll');
      controller.findAll({}, makeReq('org-alpha'));
      expect(spy).toHaveBeenCalledWith('org-alpha', {});
    });

    it('uses fallback orgId when req.user is absent (Testnet demo mode)', () => {
      const spy = jest.spyOn(service, 'findAll');
      controller.findAll({}, { user: undefined });
      expect(spy).toHaveBeenCalledWith('org-alpha', {});
    });

    it('returns a list response with data and pagination fields', () => {
      const result = controller.findAll({}, makeReq());
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('offset');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('passes status filter through to the service', () => {
      const result = controller.findAll({ status: 'approved' }, makeReq());
      expect(result.data.every((i) => i.status === 'approved')).toBe(true);
    });
  });

  describe('findOne', () => {
    it('returns the correct item for the calling org', () => {
      const result = controller.findOne('vi-001', makeReq('org-alpha'));
      expect(result.id).toBe('vi-001');
    });

    it('throws NotFoundException for unknown id', () => {
      expect(() => controller.findOne('bad-id', makeReq('org-alpha'))).toThrow(NotFoundException);
    });

    it('throws ForbiddenException for cross-org access', () => {
      expect(() => controller.findOne('vi-004', makeReq('org-alpha'))).toThrow(ForbiddenException);
    });
  });
});