import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { QueryInboxDto } from './dto/query-inbox.dto';
import { VerificationInboxListDto, VerificationInboxItemDto } from './dto/verification-inbox-response.dto';
import { VerificationInboxItem } from './verification-inbox.entity';

/**
 * VerificationInboxService
 *
 * In-memory seed data is used for Testnet demo purposes.
 * Replace the `this.items` array with real DB queries (TypeORM/Prisma)
 * once a database is wired in.
 */
@Injectable()
export class VerificationInboxService {
  // --- Testnet demo seed data -------------------------------------------
  private readonly items: VerificationInboxItem[] = [
    {
      id: 'vi-001',
      orgId: 'org-alpha',
      role: 'ngo',
      subject: 'Aid claim #001 – Food supply',
      description: 'Requesting verification for food aid disbursement to region A.',
      status: 'pending',
      requesterAddress: 'GBXYZ...001',
      createdAt: new Date('2024-06-01T10:00:00Z'),
      updatedAt: new Date('2024-06-01T10:00:00Z'),
    },
    {
      id: 'vi-002',
      orgId: 'org-alpha',
      role: 'ngo',
      subject: 'Aid claim #002 – Medical supplies',
      description: 'Verification for medical supply shipment to region B.',
      status: 'approved',
      requesterAddress: 'GBXYZ...002',
      reviewerAddress: 'GBXYZ...reviewer',
      createdAt: new Date('2024-06-02T09:30:00Z'),
      updatedAt: new Date('2024-06-03T14:00:00Z'),
    },
    {
      id: 'vi-003',
      orgId: 'org-alpha',
      role: 'ngo',
      subject: 'Aid claim #003 – Water purification',
      description: 'Rejected: insufficient supporting documentation.',
      status: 'rejected',
      requesterAddress: 'GBXYZ...003',
      reviewerAddress: 'GBXYZ...reviewer',
      createdAt: new Date('2024-06-03T08:00:00Z'),
      updatedAt: new Date('2024-06-04T11:00:00Z'),
    },
    {
      id: 'vi-004',
      orgId: 'org-beta',
      role: 'donor',
      subject: 'Donation verification #001',
      description: 'Verification for donation traceability on Testnet.',
      status: 'pending',
      requesterAddress: 'GBXYZ...004',
      createdAt: new Date('2024-06-05T12:00:00Z'),
      updatedAt: new Date('2024-06-05T12:00:00Z'),
    },
  ];
  // -----------------------------------------------------------------------

  /**
   * Returns a paginated, filtered list of verification inbox items
   * scoped to the caller's orgId.
   */
  findAll(orgId: string, query: QueryInboxDto): VerificationInboxListDto {
    this.validateDateRange(query.from, query.to);

    let results = this.items.filter((item) => item.orgId === orgId);

    if (query.status) {
      results = results.filter((item) => item.status === query.status);
    }

    if (query.from) {
      const from = new Date(query.from);
      results = results.filter((item) => item.createdAt >= from);
    }

    if (query.to) {
      const to = new Date(query.to);
      // Include the full 'to' day
      to.setHours(23, 59, 59, 999);
      results = results.filter((item) => item.createdAt <= to);
    }

    const total = results.length;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const paginated = results.slice(offset, offset + limit);

    return {
      data: paginated.map(this.toDto),
      total,
      limit,
      offset,
    };
  }

  /**
   * Returns a single verification inbox item.
   * Throws 404 if not found, 403 if the item belongs to a different org.
   */
  findOne(orgId: string, id: string): VerificationInboxItemDto {
    const item = this.items.find((i) => i.id === id);

    if (!item) {
      throw new NotFoundException(`Verification item with id "${id}" not found`);
    }

    if (item.orgId !== orgId) {
      // Return 403, not 404, so callers can't enumerate other orgs' IDs
      throw new ForbiddenException('You do not have access to this verification item');
    }

    return this.toDto(item);
  }

  // --- Private helpers ----------------------------------------------------

  private toDto(item: VerificationInboxItem): VerificationInboxItemDto {
    return {
      id: item.id,
      subject: item.subject,
      description: item.description,
      status: item.status,
      requesterAddress: item.requesterAddress,
      reviewerAddress: item.reviewerAddress,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private validateDateRange(from?: string, to?: string): void {
    if (from && to && new Date(from) > new Date(to)) {
      throw new BadRequestException('"from" date must not be after "to" date');
    }
  }
}