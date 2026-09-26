import { Injectable } from '@nestjs/common';
import { SearchIndexEntityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchResult {
  type: string;
  label: string;
  status: string;
  id: string;
}

const ENTITY_VALUES = new Set<string>(Object.values(SearchIndexEntityType));

@Injectable()
export class AdminSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    query: string,
    entity: string | undefined,
    orgId: string,
  ): Promise<SearchResult[]> {
    if (!orgId) {
      return [];
    }

    const q = (query ?? '').trim().toLowerCase();

    // Prefer the materialized search index. When it is empty (e.g. a fresh
    // deployment before the first rebuild), fall back to live queries so
    // search keeps working until a rebuild populates the index.
    const indexed = await this.prisma.searchIndexEntry.count({
      where: { orgId },
    });
    if (indexed > 0) {
      return this.searchIndexed(q, entity, orgId);
    }

    return this.searchLive(q, entity, orgId);
  }

  private async searchIndexed(
    q: string,
    entity: string | undefined,
    orgId: string,
  ): Promise<SearchResult[]> {
    const entries = await this.prisma.searchIndexEntry.findMany({
      where: {
        orgId,
        ...(entity && ENTITY_VALUES.has(entity)
          ? { entityType: entity as SearchIndexEntityType }
          : {}),
        searchText: { contains: q },
      },
      orderBy: { entityType: 'asc' },
      take: 10,
    });

    return entries.map(entry => ({
      type: entry.entityType,
      label: entry.label,
      status: entry.status,
      id: entry.entityId,
    }));
  }

  private async searchLive(
    q: string,
    entity: string | undefined,
    orgId: string,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // 1. Search Campaigns
    if (!entity || entity === 'campaign') {
      const campaigns = await this.prisma.campaign.findMany({
        where: {
          orgId,
          OR: [{ name: { contains: q } }, { id: { contains: q } }],
        },
        take: 10,
      });
      results.push(
        ...campaigns.map(c => ({
          type: 'campaign',
          label: c.name,
          status: c.status,
          id: c.id,
        })),
      );
    }

    // 2. Search Claims
    if (!entity || entity === 'claim') {
      const claims = await this.prisma.claim.findMany({
        where: {
          campaign: { orgId },
          OR: [{ id: { contains: q } }, { recipientRef: { contains: q } }],
        },
        take: 10,
      });
      results.push(
        ...claims.map(c => ({
          type: 'claim',
          label: `Claim ${c.id}`,
          status: c.status,
          id: c.id,
        })),
      );
    }

    // 3. Search Recipients (distinct from claims)
    if (!entity || entity === 'recipient') {
      const recipients = await this.prisma.claim.findMany({
        where: {
          campaign: { orgId },
          recipientRef: { contains: q },
        },
        distinct: ['recipientRef'],
        take: 10,
      });
      results.push(
        ...recipients.map(c => ({
          type: 'recipient',
          label: c.recipientRef,
          status: 'active',
          id: c.recipientRef,
        })),
      );
    }

    // 4. Search Verifications
    if (!entity || entity === 'verification') {
      const verifications = await this.prisma.verificationSession.findMany({
        where: {
          orgId,
          OR: [{ identifier: { contains: q } }, { id: { contains: q } }],
        },
        take: 10,
      });
      results.push(
        ...verifications.map(v => ({
          type: 'verification',
          label: v.identifier,
          status: v.status,
          id: v.id,
        })),
      );
    }

    return results;
  }
}
