import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ArtifactOwnershipTokenService } from '../../evidence/artifact-ownership-token.service';

export const REQUIRE_ARTIFACT_TOKEN = 'require_artifact_token';

/**
 * Guard that validates artifact ownership tokens for backend-initiated access.
 *
 * This guard ensures that:
 * 1. A valid ownership token is provided in the request
 * 2. The token is not expired
 * 3. The token is not revoked
 * 4. The token's organization matches the artifact's organization
 * 5. The token's role has sufficient permissions
 *
 * Usage:
 * @UseGuards(ArtifactTokenGuard)
 * @SetMetadata(REQUIRE_ARTIFACT_TOKEN, true)
 */
@Injectable()
export class ArtifactTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: ArtifactOwnershipTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if this route requires artifact token validation
    const requireToken = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ARTIFACT_TOKEN,
      [context.getHandler(), context.getClass()],
    );

    if (!requireToken) {
      return true; // Skip validation if not required
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Extract token from Authorization header or query parameter
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Artifact access token required');
    }

    // Verify token
    const result = await this.tokenService.verifyToken(token);

    if (!result.valid) {
      throw new UnauthorizedException(
        `Invalid artifact token: ${result.error}`,
      );
    }

    const payload = result.payload!;

    // Validate artifact ownership (org must match)
    const ownsArtifact = await this.tokenService.validateArtifactOwnership(
      payload.artifactId,
      payload.orgId,
    );

    if (!ownsArtifact) {
      throw new ForbiddenException(
        'Cross-organization artifact access denied',
      );
    }

    // Validate role permissions
    if (!this.hasRequiredRole(payload.role)) {
      throw new ForbiddenException(
        `Role '${payload.role}' lacks artifact access permissions`,
      );
    }

    // Attach token payload to request for downstream use
    request['artifactToken'] = payload;

    return true;
  }

  private extractToken(request: Request): string | null {
    // Try Authorization header first (Bearer token)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Fall back to query parameter
    const tokenQuery = request.query.token as string;
    if (tokenQuery) {
      return tokenQuery;
    }

    // Try X-Artifact-Token header
    const artifactTokenHeader = request.headers['x-artifact-token'] as string;
    if (artifactTokenHeader) {
      return artifactTokenHeader;
    }

    return null;
  }

  private hasRequiredRole(role: string): boolean {
    // Admin and operator roles have full access
    // Reviewer has read-only access
    const allowedRoles = ['admin', 'operator', 'reviewer'];
    return allowedRoles.includes(role);
  }
}

/**
 * Decorator to mark a route as requiring artifact ownership token validation.
 */
export const RequireArtifactToken = () =>
  SetMetadata(REQUIRE_ARTIFACT_TOKEN, true);