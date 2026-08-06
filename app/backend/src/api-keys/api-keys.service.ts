import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppRole } from '../auth/app-role.enum';
import { ApiKeyScope } from './api-key-scope.enum';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { RotateApiKeyDto } from './dto/rotate-api-key.dto';

type Actor = { apiKeyId?: string; authType?: string; role?: AppRole };

export type ApiKeyRotationStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'revoked'
  | 'rotated';

export type ApiKeyAdminView = {
  id: string;
  role: AppRole;
  scopes: ApiKeyScope[];
  ngoId: string | null;
  description: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  createdBy: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
  replacedById: string | null;
  keyPreview: string | null;
  expiresAt: Date | null;
  lastRemindedAt: Date | null;
  rotationStatus: ApiKeyRotationStatus;
  daysUntilExpiry: number | null;
  isHighRisk: boolean;
  rotationGuidance: string | null;
};

export type UpcomingExpiryReminder = {
  id: string;
  keyPreview: string | null;
  role: AppRole;
  scopes: ApiKeyScope[];
  description: string | null;
  expiresAt: Date;
  daysUntilExpiry: number;
  isHighRisk: boolean;
  rotationGuidance: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Default look-ahead window for expiry reminders and `expiring_soon` status. */
export const DEFAULT_API_KEY_REMINDER_WINDOW_DAYS = 14;
/** Minimum gap between reminders for the same key. */
export const DEFAULT_API_KEY_REMINDER_COOLDOWN_HOURS = 24;

const maskPreview = (rawKey: string): string => {
  const prefix = rawKey.slice(0, 6);
  const suffix = rawKey.slice(-4);
  return `${prefix}...${suffix}`;
};

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const defaultScopes: ApiKeyScope[] = [ApiKeyScope.admin];

const selectFields = {
  id: true,
  role: true,
  scopes: true,
  ngoId: true,
  description: true,
  createdAt: true,
  lastUsedAt: true,
  createdBy: true,
  revokedAt: true,
  revokedBy: true,
  revokedReason: true,
  replacedById: true,
  keyPreview: true,
  expiresAt: true,
  lastRemindedAt: true,
} as const;

function parseScopes(raw: string | null | undefined): ApiKeyScope[] {
  if (!raw) return defaultScopes;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ApiKeyScope[];
    return defaultScopes;
  } catch {
    return defaultScopes;
  }
}

function serializeScopes(scopes: ApiKeyScope[]): string {
  return JSON.stringify(scopes);
}

export function isHighRiskApiKey(
  role: AppRole,
  scopes: ApiKeyScope[],
): boolean {
  return role === AppRole.admin || scopes.includes(ApiKeyScope.admin);
}

export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / MS_PER_DAY);
}

export function buildRotationGuidance(params: {
  id: string;
  status: ApiKeyRotationStatus;
  isHighRisk: boolean;
  daysUntilExpiry: number | null;
}): string | null {
  const { id, status, isHighRisk, daysUntilExpiry } = params;

  if (status === 'expired') {
    return isHighRisk
      ? `High-risk key ${id} has expired. Rotate immediately via POST /api/v1/api-keys/${id}/rotate or revoke it.`
      : `Key ${id} has expired. Rotate via POST /api/v1/api-keys/${id}/rotate or revoke it.`;
  }

  if (status === 'expiring_soon') {
    const days = daysUntilExpiry ?? 0;
    return isHighRisk
      ? `High-risk key ${id} expires in ${days} day(s). Rotate before expiry via POST /api/v1/api-keys/${id}/rotate.`
      : `Key ${id} expires in ${days} day(s). Plan rotation via POST /api/v1/api-keys/${id}/rotate.`;
  }

  if (status === 'active' && isHighRisk) {
    return `High-risk key ${id}: rotate on a fixed schedule and set expiresAt so reminders can fire.`;
  }

  return null;
}

export function deriveRotationStatus(
  row: {
    id: string;
    role: AppRole;
    scopes: ApiKeyScope[] | string | null | undefined;
    revokedAt: Date | null;
    revokedReason: string | null;
    replacedById: string | null;
    expiresAt: Date | null;
  },
  options: { now?: Date; reminderWindowDays?: number } = {},
): Pick<
  ApiKeyAdminView,
  'rotationStatus' | 'daysUntilExpiry' | 'isHighRisk' | 'rotationGuidance'
> {
  const now = options.now ?? new Date();
  const reminderWindowDays =
    options.reminderWindowDays ?? DEFAULT_API_KEY_REMINDER_WINDOW_DAYS;
  const scopes = Array.isArray(row.scopes)
    ? row.scopes
    : parseScopes(row.scopes);
  const highRisk = isHighRiskApiKey(row.role, scopes);

  if (row.replacedById || row.revokedReason === 'rotated') {
    return {
      rotationStatus: 'rotated',
      daysUntilExpiry: null,
      isHighRisk: highRisk,
      rotationGuidance: null,
    };
  }

  if (row.revokedAt) {
    return {
      rotationStatus: 'revoked',
      daysUntilExpiry: null,
      isHighRisk: highRisk,
      rotationGuidance: null,
    };
  }

  if (row.expiresAt) {
    const remaining = daysUntil(row.expiresAt, now);
    if (row.expiresAt.getTime() <= now.getTime()) {
      const status: ApiKeyRotationStatus = 'expired';
      return {
        rotationStatus: status,
        daysUntilExpiry: remaining,
        isHighRisk: highRisk,
        rotationGuidance: buildRotationGuidance({
          id: row.id,
          status,
          isHighRisk: highRisk,
          daysUntilExpiry: remaining,
        }),
      };
    }

    if (remaining <= reminderWindowDays) {
      const status: ApiKeyRotationStatus = 'expiring_soon';
      return {
        rotationStatus: status,
        daysUntilExpiry: remaining,
        isHighRisk: highRisk,
        rotationGuidance: buildRotationGuidance({
          id: row.id,
          status,
          isHighRisk: highRisk,
          daysUntilExpiry: remaining,
        }),
      };
    }

    return {
      rotationStatus: 'active',
      daysUntilExpiry: remaining,
      isHighRisk: highRisk,
      rotationGuidance: buildRotationGuidance({
        id: row.id,
        status: 'active',
        isHighRisk: highRisk,
        daysUntilExpiry: remaining,
      }),
    };
  }

  return {
    rotationStatus: 'active',
    daysUntilExpiry: null,
    isHighRisk: highRisk,
    rotationGuidance: buildRotationGuidance({
      id: row.id,
      status: 'active',
      isHighRisk: highRisk,
      daysUntilExpiry: null,
    }),
  };
}

function toAdminView<
  T extends {
    id: string;
    role: AppRole;
    scopes?: string | null;
    ngoId: string | null;
    description: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    createdBy: string | null;
    revokedAt: Date | null;
    revokedBy: string | null;
    revokedReason: string | null;
    replacedById: string | null;
    keyPreview: string | null;
    expiresAt: Date | null;
    lastRemindedAt: Date | null;
  },
>(row: T, reminderWindowDays: number, now: Date = new Date()): ApiKeyAdminView {
  const scopes = parseScopes(row.scopes);
  const statusFields = deriveRotationStatus(
    { ...row, scopes },
    { now, reminderWindowDays },
  );

  return {
    id: row.id,
    role: row.role,
    scopes,
    ngoId: row.ngoId,
    description: row.description,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    createdBy: row.createdBy,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokedReason: row.revokedReason,
    replacedById: row.replacedById,
    keyPreview: row.keyPreview,
    expiresAt: row.expiresAt,
    lastRemindedAt: row.lastRemindedAt,
    ...statusFields,
  };
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private newRawKey(): string {
    return `s2s_${randomBytes(32).toString('base64url')}`;
  }

  private actorId(actor: Actor | undefined): string {
    if (actor?.apiKeyId) return actor.apiKeyId;
    if (actor?.authType === 'envApiKey') return 'env:API_KEY';
    if (actor?.role) return `role:${actor.role}`;
    return 'unknown';
  }

  reminderWindowDays(): number {
    const raw = this.config.get<string | number>(
      'API_KEY_EXPIRY_REMINDER_DAYS',
    );
    const parsed =
      typeof raw === 'number' ? raw : raw != null ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
    return DEFAULT_API_KEY_REMINDER_WINDOW_DAYS;
  }

  reminderCooldownMs(): number {
    const raw = this.config.get<string | number>(
      'API_KEY_EXPIRY_REMINDER_COOLDOWN_HOURS',
    );
    const parsed =
      typeof raw === 'number' ? raw : raw != null ? Number(raw) : NaN;
    const hours =
      Number.isFinite(parsed) && parsed >= 1
        ? Math.floor(parsed)
        : DEFAULT_API_KEY_REMINDER_COOLDOWN_HOURS;
    return hours * 60 * 60 * 1000;
  }

  resolveExpiresAt(input: {
    expiresAt?: string;
    expiresInDays?: number;
  }): Date | null {
    if (input.expiresAt != null && input.expiresInDays != null) {
      throw new BadRequestException(
        'Provide either expiresAt or expiresInDays, not both',
      );
    }

    if (input.expiresAt != null) {
      const expiresAt = new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('expiresAt must be a valid ISO datetime');
      }
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      return expiresAt;
    }

    if (input.expiresInDays != null) {
      return new Date(Date.now() + input.expiresInDays * MS_PER_DAY);
    }

    return null;
  }

  async create(dto: CreateApiKeyDto, actor?: Actor) {
    if (dto.role === AppRole.ngo && !dto.ngoId) {
      throw new BadRequestException('ngoId is required for NGO API keys');
    }

    const rawKey = this.newRawKey();
    const keyHash = sha256Hex(rawKey);
    const keyPreview = maskPreview(rawKey);
    const scopes = dto.scopes ?? defaultScopes;
    const expiresAt = this.resolveExpiresAt(dto);

    const row = await this.prisma.apiKey.create({
      data: {
        keyHash,
        keyPreview,
        role: dto.role,
        scopes: serializeScopes(scopes),
        ngoId: dto.ngoId ?? null,
        description: dto.description ?? null,
        createdBy: this.actorId(actor),
        expiresAt,
      },
      select: selectFields,
    });

    return { ...toAdminView(row, this.reminderWindowDays()), apiKey: rawKey };
  }

  async list() {
    const rows = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: selectFields,
    });

    const windowDays = this.reminderWindowDays();
    return rows.map(row => toAdminView(row, windowDays));
  }

  async revoke(id: string, reason: string | undefined, actor?: Actor) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    if (existing.revokedAt) {
      const row = await this.prisma.apiKey.findUnique({
        where: { id },
        select: selectFields,
      });
      return toAdminView(row!, this.reminderWindowDays());
    }

    const row = await this.prisma.apiKey.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedBy: this.actorId(actor),
        revokedReason: reason ?? 'revoked',
      },
      select: selectFields,
    });

    return toAdminView(row, this.reminderWindowDays());
  }

  async rotate(id: string, actor?: Actor, dto: RotateApiKeyDto = {}) {
    return this.prisma.$transaction(async tx => {
      const existing = await tx.apiKey.findUnique({
        where: { id },
        select: {
          id: true,
          role: true,
          ngoId: true,
          description: true,
          scopes: true,
          revokedAt: true,
          expiresAt: true,
        },
      });
      if (!existing) {
        throw new NotFoundException('API key not found');
      }
      if (existing.revokedAt) {
        throw new BadRequestException('Cannot rotate a revoked API key');
      }

      const rawKey = this.newRawKey();
      const keyHash = sha256Hex(rawKey);
      const keyPreview = maskPreview(rawKey);

      const hasExplicitExpiry =
        dto.expiresAt != null || dto.expiresInDays != null;
      const expiresAt = hasExplicitExpiry
        ? this.resolveExpiresAt(dto)
        : existing.expiresAt;

      const replacement = await tx.apiKey.create({
        data: {
          keyHash,
          keyPreview,
          role: existing.role,
          scopes: existing.scopes,
          ngoId: existing.ngoId,
          description: existing.description,
          createdBy: this.actorId(actor),
          expiresAt,
        },
        select: selectFields,
      });

      await tx.apiKey.update({
        where: { id: existing.id },
        data: {
          revokedAt: new Date(),
          revokedBy: this.actorId(actor),
          revokedReason: 'rotated',
          replacedById: replacement.id,
        },
      });

      return {
        replacement: toAdminView(replacement, this.reminderWindowDays()),
        apiKey: rawKey,
      };
    });
  }

  /**
   * Finds active keys approaching expiry and surfaces reminders (log + audit).
   * Deduplicates using lastRemindedAt cooldown.
   */
  async surfaceUpcomingExpirations(
    now: Date = new Date(),
  ): Promise<UpcomingExpiryReminder[]> {
    const windowDays = this.reminderWindowDays();
    const cooldownMs = this.reminderCooldownMs();
    const windowEnd = new Date(now.getTime() + windowDays * MS_PER_DAY);
    const remindBefore = new Date(now.getTime() - cooldownMs);

    const rows = await this.prisma.apiKey.findMany({
      where: {
        revokedAt: null,
        expiresAt: {
          not: null,
          lte: windowEnd,
        },
        OR: [
          { lastRemindedAt: null },
          { lastRemindedAt: { lte: remindBefore } },
        ],
      },
      select: selectFields,
      orderBy: { expiresAt: 'asc' },
    });

    const reminders: UpcomingExpiryReminder[] = [];

    for (const row of rows) {
      if (!row.expiresAt) continue;

      const view = toAdminView(row, windowDays, now);
      const guidance =
        view.rotationGuidance ??
        buildRotationGuidance({
          id: view.id,
          status: view.rotationStatus,
          isHighRisk: view.isHighRisk,
          daysUntilExpiry: view.daysUntilExpiry,
        }) ??
        `API key ${view.id} expires at ${row.expiresAt.toISOString()}. Rotate via POST /api/v1/api-keys/${view.id}/rotate.`;

      const reminder: UpcomingExpiryReminder = {
        id: view.id,
        keyPreview: view.keyPreview,
        role: view.role,
        scopes: view.scopes,
        description: view.description,
        expiresAt: row.expiresAt,
        daysUntilExpiry: view.daysUntilExpiry ?? daysUntil(row.expiresAt, now),
        isHighRisk: view.isHighRisk,
        rotationGuidance: guidance,
      };
      reminders.push(reminder);

      const level =
        view.isHighRisk || view.rotationStatus === 'expired' ? 'warn' : 'log';
      this.logger[level](
        `API key expiry reminder: ${reminder.keyPreview ?? reminder.id} ` +
          `(${reminder.rotationGuidance})`,
      );

      await this.audit.record({
        actorId: 'system:api-key-expiry',
        entity: 'ApiKey',
        entityId: reminder.id,
        action: 'expiry_reminder',
        metadata: {
          keyPreview: reminder.keyPreview,
          expiresAt: reminder.expiresAt.toISOString(),
          daysUntilExpiry: reminder.daysUntilExpiry,
          isHighRisk: reminder.isHighRisk,
          rotationStatus: view.rotationStatus,
          rotationGuidance: reminder.rotationGuidance,
        },
      });

      await this.prisma.apiKey.update({
        where: { id: row.id },
        data: { lastRemindedAt: now },
      });
    }

    if (reminders.length > 0) {
      this.logger.log(
        `Surfaced ${reminders.length} API key expiry reminder(s) ` +
          `(${reminders.filter(r => r.isHighRisk).length} high-risk).`,
      );
    }

    return reminders;
  }
}
