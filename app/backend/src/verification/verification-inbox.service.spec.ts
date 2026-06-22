import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { VerificationInboxService } from './verification-inbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { VerificationStatus } from '@prisma/client';

describe('VerificationInboxService', () => {
  let service: VerificationInboxService;
  let prismaMock: DeepMockProxy<PrismaService>;
  let auditMock: DeepMockProxy<AuditService>;

  const now = new Date('2026-01-25T00:00:00.000Z');

  const baseVerification = {
    id: 'v1',
    status: 'pending_review' as VerificationStatus,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    orgId: null,
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
  };

  beforeEach(async () => {
    prismaMock = mockDeep<PrismaService>();
    auditMock = mockDeep<AuditService>();
    auditMock.record.mockResolvedValue(undefined as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationInboxService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get<VerificationInboxService>(VerificationInboxService);
  });

  describe('updateStatus()', () => {
    it('throws NotFoundException when verification not found', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('missing', 'approved', 'reviewer-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when already approved', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue({
        ...baseVerification,
        status: 'approved' as VerificationStatus,
      });

      await expect(
        service.updateStatus('v1', 'approved', 'reviewer-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates status and records audit trail', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(
        baseVerification,
      );
      const updated = {
        ...baseVerification,
        status: 'approved' as VerificationStatus,
        reviewedAt: now,
        reviewedBy: 'reviewer-1',
      };
      prismaMock.verificationRequest.update.mockResolvedValue(updated);

      const result = await service.updateStatus('v1', 'approved', 'reviewer-1');

      expect(result.status).toBe('approved');
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'reviewer-1',
          entity: 'VerificationRequest',
          entityId: 'v1',
          action: 'review_approved',
        }),
      );
    });

    it('creates internal note when provided', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(
        baseVerification,
      );
      prismaMock.verificationRequest.update.mockResolvedValue({
        ...baseVerification,
        status: 'approved' as VerificationStatus,
        reviewedAt: now,
        reviewedBy: 'reviewer-1',
      });
      prismaMock.internalNote.create.mockResolvedValue({
        id: 'note-1',
        entityType: 'verification',
        entityId: 'v1',
        content: 'Looks good',
        authorId: 'reviewer-1',
        category: 'review_approved',
        createdAt: now,
        updatedAt: now,
      });

      await service.updateStatus(
        'v1',
        'approved',
        'reviewer-1',
        undefined,
        undefined,
        'Looks good',
      );

      expect(prismaMock.internalNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'verification',
            entityId: 'v1',
            content: 'Looks good',
            authorId: 'reviewer-1',
          }),
        }),
      );
    });

    it('does not create internal note when not provided', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(
        baseVerification,
      );
      prismaMock.verificationRequest.update.mockResolvedValue({
        ...baseVerification,
        status: 'approved' as VerificationStatus,
        reviewedAt: now,
        reviewedBy: 'reviewer-1',
      });

      await service.updateStatus('v1', 'approved', 'reviewer-1');

      expect(prismaMock.internalNote.create).not.toHaveBeenCalled();
    });
  });

  describe('addInternalNote()', () => {
    it('throws NotFoundException when verification not found', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.addInternalNote('missing', 'note content', 'author-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates note and records audit trail', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(
        baseVerification,
      );
      const note = {
        id: 'note-1',
        entityType: 'verification',
        entityId: 'v1',
        content: 'Follow up needed',
        authorId: 'author-1',
        category: 'follow_up',
        createdAt: now,
        updatedAt: now,
      };
      prismaMock.internalNote.create.mockResolvedValue(note);

      const result = await service.addInternalNote(
        'v1',
        'Follow up needed',
        'author-1',
        'follow_up',
      );

      expect(result).toEqual(note);
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'author-1',
          entity: 'VerificationRequest',
          entityId: 'v1',
          action: 'internal_note_added',
        }),
      );
    });
  });

  describe('getInternalNotes()', () => {
    it('throws NotFoundException when verification not found', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(null);

      await expect(service.getInternalNotes('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns notes for a verification request', async () => {
      prismaMock.verificationRequest.findUnique.mockResolvedValue(
        baseVerification,
      );
      const notes = [
        {
          id: 'note-1',
          entityType: 'verification',
          entityId: 'v1',
          content: 'Note 1',
          authorId: 'author-1',
          category: null,
          createdAt: now,
          updatedAt: now,
        },
      ];
      prismaMock.internalNote.findMany.mockResolvedValue(notes);

      const result = await service.getInternalNotes('v1');

      expect(result).toEqual(notes);
      expect(prismaMock.internalNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityType: 'verification', entityId: 'v1' },
        }),
      );
    });
  });
});
