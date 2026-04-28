import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface SearchResult {
  type: string;
  label: string;
  status: string;
  id: string;
}

@Injectable()
export class AdminSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, entity: string | undefined, orgId: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const q = query.toLowerCase();

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
        ...campaigns.map((c): SearchResult => ({
          type: 'campaign',
          label: c.name,
          status: c.status.toString(),
          id: c.id,
        }))
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
        ...claims.map((c): SearchResult => ({
          type: 'claim',
          label: `Claim ${c.id}`,
          status: c.status.toString(),
          id: c.id,
        }))
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
        ...recipients.map((c): SearchResult => ({
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
        ...verifications.map((v): SearchResult => ({
          type: 'verification',
          label: v.identifier,
          status: v.status.toString(),
          id: v.id,
        }))
      );
    }

    return results;
  }
}
