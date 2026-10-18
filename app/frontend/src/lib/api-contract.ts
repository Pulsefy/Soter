/**
 * Shared API contract — the single source of truth the mock handlers are
 * validated against (issue #1143).
 *
 * Every type here mirrors what the real backend (`app/backend`) returns. Where
 * a frontend shared type already mirrors the backend exactly, the contract
 * reuses it (`@/types/*`); this file only adds the wire shapes that had no
 * frontend equivalent yet.
 *
 * Backend sources of truth:
 *  - Envelope .......... `ApiResponseDto`             app/backend/src/common/dto/api-response.dto.ts
 *  - Health ............ `LivenessResponse`           app/backend/src/health/health.service.ts
 *  - Global stats ...... `GlobalStatsDto`             app/backend/src/analytics/dto/index.ts
 *  - Campaigns ......... Prisma `Campaign` + `CampaignStatus`
 *                       app/backend/prisma/schema.prisma
 *  - Activity feed ..... `NotificationsService.ActivityFeedItem`
 *                       (consumed by src/hooks/useActivity.ts)
 *  - Recipient import .. consumed by src/lib/csv-validation.ts
 *  - WebAuthn .......... consumed by src/services/biometricService.ts
 *
 * ## OpenAPI status
 *
 * The backend generates a Swagger document (SwaggerModule in
 * app/backend/src/main.ts) and a copy is committed at
 * `app/backend/openapi/openapi.json`, but as of this writing that document has
 * no `paths` (it is an empty placeholder). The contract test therefore
 * validates handlers against these shared types, and automatically also
 * validates against the OpenAPI schema for any endpoint the document does
 * cover — so the moment the committed schema is populated, the real schema
 * starts being enforced without further changes.
 */

/** Wire envelope for successful JSON responses (`ApiResponseDto.ok`). */
export interface ApiSuccessEnvelope<T> {
  success: true;
  message?: string;
  data: T;
}

/** Wire envelope for handled failures (`ApiResponseDto.fail`). */
export interface ApiErrorEnvelope {
  success: false;
  message: string;
  error?: unknown;
  /** `ApiResponseDto.fail` always serializes `data: null`. */
  data: null;
}

/** Mirrors `HealthCheckResult` in app/backend/src/health/health.service.ts. */
export interface ContractHealthCheckResult {
  status: 'up' | 'down' | 'skipped';
  details?: Record<string, unknown>;
}

/** Mirrors the backend `LivenessResponse` served by `GET /health`. */
export interface ContractLivenessResponse {
  status: 'ok';
  service: 'backend';
  version: string;
  environment: string;
  timestamp: string;
  checks: {
    process: ContractHealthCheckResult;
  };
}

/** Mirrors `BreakdownEntry` (analytics DTO). */
export interface ContractBreakdownEntry {
  label: string;
  totalAmount: number;
  count: number;
}

/** Mirrors `TimeframeBucket` (analytics DTO). */
export interface ContractTimeframeBucket {
  date: string;
  totalAmount: number;
  count: number;
}

/**
 * Mirrors `GlobalStatsDto` served by `GET /analytics/global-stats`
 * (app/backend/src/analytics/dto/index.ts).
 */
export interface ContractGlobalStats {
  totalClaims: number;
  totalPackages: number;
  pendingReviews: number;
  totalDisbursements: number;
  totalAidDisbursed: number;
  totalRecipients: number;
  activeCampaigns: number;
  byToken: ContractBreakdownEntry[];
  byRegion: ContractBreakdownEntry[];
  timeSeries: ContractTimeframeBucket[];
  computedAt: string;
}

/**
 * Activity feed item as returned inside the `data` array by the real
 * `GET /api/v1/notifications/activity-feed`
 * (see `ActivityFeedItemResponse` in src/hooks/useActivity.ts).
 */
export interface ContractActivityFeedItem {
  id: string;
  type: 'notification' | 'audit' | 'review';
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  correlationId?: string;
  linkHref?: string;
  linkLabel?: string;
  metadata?: Record<string, unknown>;
}

/** Validation message inside a recipient-import row (`csv-validation.ts`). */
export interface ContractRecipientImportMessage {
  severity: 'warning' | 'error';
  field?: string;
  message: string;
}

/** One validated CSV row returned by `POST /recipients/import/validate`. */
export interface ContractRecipientImportRowResult {
  rowNumber: number;
  status: 'valid' | 'warning' | 'error';
  messages: ContractRecipientImportMessage[];
}

/** Response of `POST /recipients/import/validate` (consumed by csv-validation.ts). */
export interface ContractRecipientImportValidateResponse {
  success: true;
  rows: ContractRecipientImportRowResult[];
}

/** Response of `POST /recipients/import/confirm` (consumed by csv-validation.ts). */
export interface ContractRecipientImportConfirmResponse {
  success: true;
  message: string;
}

/** Registration options returned by `GET /auth/webauthn/register/options`. */
export interface ContractWebAuthnRegistrationOptions {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ alg: number; type: 'public-key' }>;
  timeout?: number;
  attestation?: string;
  authenticatorSelection?: Record<string, unknown>;
  excludeCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: string[];
  }>;
}

/** Assertion options returned by `GET /auth/webauthn/auth/options`. */
export interface ContractWebAuthnAuthenticationOptions {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: string[];
  }>;
  userVerification?: string;
  extensions?: Record<string, unknown>;
}

/** Response of the WebAuthn verify endpoints (`biometricService.VerifyResponse`). */
export interface ContractWebAuthnVerifyResponse {
  verified: boolean;
  message?: string;
  credentialId?: string;
  counter?: number;
}
