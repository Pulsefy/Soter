import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * SandboxGuard gates all sandbox endpoints behind the SANDBOX_ENABLED environment variable.
 *
 * Reads `process.env.SANDBOX_ENABLED` directly on every request — no ConfigService injection —
 * so it can be applied as a simple class-level guard without circular dependency concerns.
 *
 * Returns `true` only when SANDBOX_ENABLED is exactly `"true"`.
 * Throws ForbiddenException for any other value, including undefined/absent.
 */
@Injectable()
export class SandboxGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (process.env.SANDBOX_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Sandbox endpoints are disabled. Set SANDBOX_ENABLED=true to enable.',
      );
    }
    return true;
  }
}
