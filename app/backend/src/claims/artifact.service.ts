import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppRole } from '../auth/app-role.enum';

const ALLOWED_ROLES: AppRole[] = [AppRole.admin, AppRole.operator, AppRole.ngo];
const TTL_SECONDS = 300; // 5 minutes

export interface SignedToken {
  claimId: string;
  actorId: string;
  exp: number;
}

@Injectable()
export class ArtifactService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {
    this.secret = this.config.getOrThrow<string>('ARTIFACT_SIGNING_SECRET');
  }

  /** Issue a short-lived signed token for a claim's evidence artifact. */
  async issueSignedUrl(
    claimId: string,
    actorId: string,
    actorRole: AppRole,
    orgId?: string,
  ): Promise<{ url: string; expiresAt: string }> {
    this.assertRole(actorRole);

    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { campaign: true },
    });

    if (!claim) throw new NotFoundException('Claim not found');
    if (!claim.evidenceRef) throw new NotFoundException('No artifact on file');

    // NGO callers may only access claims belonging to their own org campaign.
    if (actorRole === AppRole.ngo) {
      const meta = claim.campaign.metadata as Record<string, unknown> | null;
      if (!orgId || meta?.orgId !== orgId) {
        throw new ForbiddenException('Claim does not belong to your org');
      }
    }

    const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const payload: SignedToken = { claimId, actorId, exp };
    const token = this.sign(payload);

    await this.auditService.record({
      actorId,
      entity: 'artifact',
      entityId: claimId,
      action: 'signed_url_issued',
      metadata: { role: actorRole, exp },
    });

    return {
      url: `/v1/claims/${claimId}/artifact?token=${token}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** Verify the token and return the evidenceRef for proxying. */
  async redeemToken(
    claimId: string,
    token: string,
    actorId: string,
  ): Promise<string> {
    const payload = this.verify(token);

    if (payload.claimId !== claimId) {
      throw new ForbiddenException('Token does not match claim');
    }
    if (Math.floor(Date.now() / 1000) > payload.exp) {
      throw new UnauthorizedException('Signed URL has expired');
    }

    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim?.evidenceRef) throw new NotFoundException('Artifact not found');

    await this.auditService.record({
      actorId,
      entity: 'artifact',
      entityId: claimId,
      action: 'artifact_accessed',
      metadata: { tokenActorId: payload.actorId },
    });

    return claim.evidenceRef;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private assertRole(role: AppRole) {
    if (!ALLOWED_ROLES.includes(role)) {
      throw new ForbiddenException('Insufficient role to access artifacts');
    }
  }

  private sign(payload: SignedToken): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  private verify(token: string): SignedToken {
    const dot = token.lastIndexOf('.');
    if (dot === -1) throw new UnauthorizedException('Malformed token');

    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac('sha256', this.secret)
      .update(data)
      .digest('base64url');

    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new UnauthorizedException('Invalid token signature');
    }

    try {
      return JSON.parse(Buffer.from(data, 'base64url').toString()) as SignedToken;
    } catch {
      throw new UnauthorizedException('Malformed token payload');
    }
  }
}
