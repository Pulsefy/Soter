import { HttpException, Injectable } from '@nestjs/common';
import { AuditService } from './audit.service';

export interface AdminActionTarget {
  type: string;
  id: string;
}

export interface AdminActionRequest {
  user?: { id?: string; sub?: string; apiKeyId?: string; address?: string };
  correlationId?: string;
  requestId?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export function getAdminActionActor(request: AdminActionRequest): string {
  return (
    request.user?.sub ??
    request.user?.id ??
    request.user?.apiKeyId ??
    request.user?.address ??
    'unknown'
  );
}

export function getAdminActionCorrelationId(
  request: AdminActionRequest,
): string | null {
  const headerId =
    request.headers?.['x-correlation-id'] ?? request.headers?.['x-request-id'];
  const headerValue = Array.isArray(headerId) ? headerId[0] : headerId;
  return request.correlationId ?? request.requestId ?? headerValue ?? null;
}

export interface AdminActionState {
  [key: string]: unknown;
}

interface AdminActionEventBase {
  actor: string;
  action: string;
  target: AdminActionTarget | null;
  before: AdminActionState | null;
  after: AdminActionState | null;
  details?: AdminActionState | null;
  correlationId: string | null;
}

export type AdminActionEvent =
  | (AdminActionEventBase & { outcome: 'success'; error?: never })
  | (AdminActionEventBase & {
      outcome: 'rejected' | 'failed';
      error: { code: string };
    });

export interface AdminActionFailure {
  outcome: 'rejected' | 'failed';
  error: { code: string };
}

export interface AdminActionContext {
  actor: string;
  action: string;
  target: AdminActionTarget | null | (() => AdminActionTarget | null);
  before: AdminActionState | null | (() => AdminActionState | null);
  details?:
    | AdminActionState
    | null
    | (() => AdminActionState | null);
  correlationId: string | null;
}

type ResolvedAdminActionContext = Omit<
  AdminActionContext,
  'target' | 'before' | 'details'
> & {
  target: AdminActionTarget | null;
  before: AdminActionState | null;
  details?: AdminActionState | null;
};

@Injectable()
export class AdminActionLogger {
  constructor(private readonly auditService: AuditService) {}

  async execute<T>(
    context: AdminActionContext,
    operation: () => Promise<T>,
    after: (
      result: T,
    ) => AdminActionState | null | Promise<AdminActionState | null>,
    succeeded: (result: T) => boolean = () => true,
  ): Promise<T> {
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await this.record({
        ...this.resolveContext(context),
        after: null,
        ...this.classifyFailure(error),
      });
      throw error;
    }

    if (succeeded(result)) {
      let afterState: AdminActionState | null = null;
      try {
        afterState = await after(result);
      } catch {
        afterState = null;
      }
      await this.record({
        ...this.resolveContext(context),
        after: afterState,
        outcome: 'success',
      });
    } else {
      await this.record({
        ...this.resolveContext(context),
        after: null,
        outcome: 'failed',
        error: { code: 'TRANSACTION_FAILED' },
      });
    }

    return result;
  }

  async record(event: AdminActionEvent): Promise<void> {
    const severity =
      event.outcome === 'success'
        ? 'info'
        : event.outcome === 'rejected'
          ? 'warn'
          : 'error';

    await this.auditService.record({
      actorId: event.actor,
      entity: event.target?.type ?? 'admin_action',
      entityId: event.target?.id ?? 'unavailable',
      action: event.action,
      metadata: {
        target: event.target,
        before: this.sanitizeState(event.before),
        after: this.sanitizeState(event.after),
        ...(event.details
          ? { details: this.sanitizeState(event.details) }
          : {}),
        correlationId: event.correlationId,
        outcome: event.outcome,
        severity,
        error: event.outcome === 'success' ? null : event.error,
      },
    });
  }

  classifyFailure(error: unknown): AdminActionFailure {
    const candidate =
      typeof error === 'object' && error !== null
        ? (error as { statusCode?: unknown; errorCode?: unknown })
        : null;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : typeof candidate?.statusCode === 'number'
          ? candidate.statusCode
          : null;

    if (status !== null) {
      const errorCode =
        typeof candidate?.errorCode === 'string' &&
        /^[A-Z0-9_]{1,64}$/.test(candidate.errorCode)
          ? candidate.errorCode
          : `HTTP_${status}`;
      return {
        outcome: status >= 400 && status < 500 ? 'rejected' : 'failed',
        error: { code: errorCode },
      };
    }

    return {
      outcome: 'failed',
      error: { code: 'UNEXPECTED_ERROR' },
    };
  }

  private sanitizeState(
    state: AdminActionState | null,
  ): AdminActionState | null {
    if (!state) return null;

    const sensitiveField =
      /secret|access.?token|auth.?token|refresh.?token|^token$|password|authorization|credential|private.?key|access.?key|headers|payload/i;
    const sanitize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sanitize);
      if (typeof value !== 'object' || value === null) return value;

      return Object.fromEntries(
        Object.entries(value).flatMap(([key, nestedValue]) =>
          sensitiveField.test(key) ? [] : [[key, sanitize(nestedValue)]],
        ),
      );
    };

    return sanitize(state) as AdminActionState;
  }

  private resolve<T>(value: T | (() => T)): T {
    return typeof value === 'function' ? (value as () => T)() : value;
  }

  private resolveContext(
    context: AdminActionContext,
  ): ResolvedAdminActionContext {
    const details =
      context.details === undefined ? undefined : this.resolve(context.details);
    return {
      actor: context.actor,
      action: context.action,
      target: this.resolve(context.target),
      before: this.resolve(context.before),
      ...(details === undefined ? {} : { details }),
      correlationId: context.correlationId,
    };
  }
}