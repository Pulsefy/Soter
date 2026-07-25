import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';

export interface ArtifactAccessTokenPayload {
  artifactId: string;
  orgId: string;
  userId: string;
  role: string;
  exp: number;
  iat: number;
}

export interface CreateTokenOptions {
  artifactId: string;
  orgId: string;
  userId: string;
  role: string;
  ttlSeconds?: number;
}

export interface VerifyTokenResult {
  valid: boolean;
  payload?: ArtifactAccessTokenPayload;
  error?: string;
}

@Injectable()
export class ArtifactOwnershipTokenService {
  private readonly logger = new Logger(ArtifactOwnershipTokenService.name);
  private readonly signingSecret: string;
  private readonly defaultTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {
    const secret = this.configService.get<string>(
      'ARTIFACT_TOKEN_SIGNING_SECRET',
    );
    if (!secret || secret.length < 32) {
      this.logger.warn(
        'ARTIFACT_TOKEN_SIGNING_SECRET is not set or too short. Using insecure fallback.',
      );
    }
    this.signingSecret =
      secret ?? 'insecure-default-change-in-production-32chars!!';

    this.defaultTtlSeconds = parseInt(
      this.configService.get<string>('ARTIFACT_TOKEN_TTL_SECONDS') || '300',
      10,
    );
  }

  /**
   * Creates a signed artifact ownership token.
   * The token is bound to a specific artifact, organization, user, and role.
   */
  async createToken(options: CreateTokenOptions): Promise<string> {
    const { artifactId, orgId, userId, role, ttlSeconds } = options;
    const effectiveTtl = ttlSeconds ?? this.defaultTtlSeconds;

    if (effectiveTtl <= 0 || effectiveTtl > 3600) {
      throw new Error('TTL must be between 1 and 3600 seconds');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload: ArtifactAccessTokenPayload = {
      artifactId,
      orgId,
      userId,
      role,
      iat: now,
      exp: now + effectiveTtl,
    };

    // Create token: base64url(payload).base64url(signature)
    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr).toString('base64url');

    const signature = crypto
      .createHmac('sha256', this.signingSecret)
      .update(payloadB64)
      .digest();
    const signatureB64 = signature.toString('base64url');

    const token = `${payloadB64}.${signatureB64}`;

    // Store token hash for revocation tracking
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(payload.exp * 1000);

    await this.prisma.artifactAccessToken.create({
      data: {
        artifactId,
        orgId,
        userId,
        role,
        tokenHash,
        expiresAt,
      },
    });

    await this.auditService.record({
      actorId: userId,
      entity: 'artifact_access_token',
      entityId: artifactId,
      action: 'token_created',
      metadata: { orgId, role, expiresAt: expiresAt.toISOString() },
    });

    this.logger.debug(
      `Created artifact access token for artifact ${artifactId}, org ${orgId}`,
    );

    return token;
  }

  /**
   * Verifies a token's signature, expiration, and revocation status.
   */
  async verifyToken(token: string): Promise<VerifyTokenResult> {
    try {
      // Split token into payload and signature
      const parts = token.split('.');
      if (parts.length !== 2) {
        return { valid: false, error: 'invalid_token_format' };
      }

      const [payloadB64, signatureB64] = parts;

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', this.signingSecret)
        .update(payloadB64)
        .digest();
      const suppliedSignature = Buffer.from(signatureB64, 'base64url');

      if (
        expectedSignature.length !== suppliedSignature.length ||
        !crypto.timingSafeEqual(expectedSignature, suppliedSignature)
      ) {
        return { valid: false, error: 'invalid_signature' };
      }

      // Decode payload
      const payloadStr = Buffer.from(payloadB64, 'base64url').toString(
        'utf-8',
      );
      const payload = JSON.parse(payloadStr) as ArtifactAccessTokenPayload;

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) {
        return { valid: false, error: 'token_expired' };
      }

      // Check revocation
      const tokenHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
      const revokedToken = await this.prisma.artifactAccessToken.findUnique({
        where: { tokenHash },
      });

      if (revokedToken?.revokedAt) {
        return { valid: false, error: 'token_revoked' };
      }

      return { valid: true, payload };
    } catch (error) {
      this.logger.error(
        `Token verification failed: ${(error as Error).message}`,
      );
      return { valid: false, error: 'token_verification_failed' };
    }
  }

  /**
   * Revokes a token by setting revokedAt and revokedReason.
   */
  async revokeToken(
    tokenHash: string,
    revokedBy: string,
    reason: string = 'user_requested',
  ): Promise<void> {
    const tokenRecord = await this.prisma.artifactAccessToken.findUnique({
      where: { tokenHash },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Token not found');
    }

    if (tokenRecord.revokedAt) {
      throw new ForbiddenException('Token already revoked');
    }

    await this.prisma.artifactAccessToken.update({
      where: { tokenHash },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });

    await this.auditService.record({
      actorId: revokedBy,
      entity: 'artifact_access_token',
      entityId: tokenRecord.artifactId,
      action: 'token_revoked',
      metadata: { reason, originalUserId: tokenRecord.userId },
    });

    this.logger.log(
      `Revoked artifact access token for artifact ${tokenRecord.artifactId}`,
    );
  }

  /**
   * Validates that an artifact belongs to the specified organization.
   */
  async validateArtifactOwnership(
    artifactId: string,
    orgId: string,
  ): Promise<boolean> {
    // Check if artifact exists in the evidence queue
    const artifact = await this.prisma.evidenceQueueItem.findUnique({
      where: { id: artifactId },
      select: { orgId: true },
    });

    if (!artifact) {
      throw new UnauthorizedException('Artifact not found');
    }

    // Allow access if artifact has no org (legacy) or belongs to the requesting org
    return !artifact.orgId || artifact.orgId === orgId;
  }

  /**
   * Cleans up expired tokens from the database.
   */
  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.prisma.artifactAccessToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
        revokedAt: null, // Don't delete revoked tokens (keep for audit)
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired artifact tokens`);
    }

    return result.count;
  }
}