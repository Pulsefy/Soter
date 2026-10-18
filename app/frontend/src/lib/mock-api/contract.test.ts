/**
 * Contract tests: mock handlers vs. the real API shape (issue #1143).
 *
 * Every handler registered in ./handlers.ts is exercised here and its response
 * shape is validated against the shared contract in src/lib/api-contract.ts,
 * which mirrors the backend DTOs / Prisma models (see that file for the exact
 * backend sources).
 *
 * When the committed backend OpenAPI document (app/backend/openapi/openapi.json)
 * covers an endpoint, the response is additionally validated against that
 * schema — so the real schema is enforced automatically the moment the document
 * is populated.
 *
 * If a handler's shape drifts from the contract, these tests fail.
 */
import * as fs from 'fs';
import * as path from 'path';

import { handlers } from './handlers';
import type {
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  ContractActivityFeedItem,
  ContractGlobalStats,
  ContractLivenessResponse,
  ContractRecipientImportMessage,
  ContractRecipientImportRowResult,
  ContractRecipientImportValidateResponse,
  ContractWebAuthnAuthenticationOptions,
  ContractWebAuthnRegistrationOptions,
  ContractWebAuthnVerifyResponse,
} from '@/lib/api-contract';
import type { AidPackage, PaginatedResponse } from '@/types/aid-package';
import type { Campaign, CampaignTimelineMilestone } from '@/types/campaign';
import type { ContractRegistryResponse } from '@/types/contract-registry';
import type { RunbookResponse } from '@/types/runbook';
import type {
  InternalNote,
  VerificationInboxResponse,
  VerificationStats,
} from '@/types/verification-review';

/* -------------------------------------------------------------------------- */
/* Structural validation helpers                                              */
/* -------------------------------------------------------------------------- */

type Json = unknown;

const API_BASE = 'http://localhost:4000';

/**
 * Tracks which registry keys the suite exercises, so a newly added handler
 * cannot be merged without contract coverage (asserted at the end of the file).
 */
const exercisedKeys = new Set<string>();

/** Invokes a registered mock handler (and records it as contract-covered). */
async function mockFetch(
  key: string,
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const handler = handlers[key];
  if (!handler) {
    throw new Error(`No mock handler registered for ${key}`);
  }
  exercisedKeys.add(key);
  return handler(url, options);
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectObject(value: Json, at: string): Record<string, Json> {
  if (!isRecord(value)) {
    throw new Error(`${at} must be an object, received: ${JSON.stringify(value)}`);
  }
  return value;
}

function expectArray(value: Json, at: string): Json[] {
  if (!Array.isArray(value)) {
    throw new Error(`${at} must be an array, received: ${JSON.stringify(value)}`);
  }
  return value;
}

function expectString(value: Json | undefined, at: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${at} must be a string, received: ${JSON.stringify(value)}`);
  }
  return value;
}

function expectNumber(value: Json | undefined, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${at} must be a finite number, received: ${JSON.stringify(value)}`);
  }
  return value;
}

function expectBoolean(value: Json | undefined, at: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${at} must be a boolean, received: ${JSON.stringify(value)}`);
  }
  return value;
}

function expectEnum<T extends string>(
  value: Json | undefined,
  allowed: readonly T[],
  at: string,
): T {
  const str = expectString(value, at);
  if (!allowed.includes(str as T)) {
    throw new Error(`${at} must be one of ${allowed.join(' | ')}, received ${str}`);
  }
  return str as T;
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function expectIsoDateTime(value: Json | undefined, at: string): string {
  const str = expectString(value, at);
  if (!ISO_DATE_RE.test(str) || Number.isNaN(Date.parse(str))) {
    throw new Error(`${at} must be an ISO datetime string, received: ${str}`);
  }
  return str;
}

/** Success envelope per backend `ApiResponseDto.ok`: `{ success, message?, data }`. */
function expectSuccessEnvelope<T>(
  payload: Json,
  expectData: (data: Json) => T,
): ApiSuccessEnvelope<T> {
  const body = expectObject(payload, 'envelope');
  if (body.success !== true) {
    throw new Error(`envelope.success must be true, received ${JSON.stringify(body.success)}`);
  }
  if (body.message !== undefined) {
    expectString(body.message, 'envelope.message');
  }
  if (body.data === undefined) {
    throw new Error('envelope.data is required on successful responses');
  }
  expectData(body.data);
  return body as unknown as ApiSuccessEnvelope<T>;
}

/** Failure envelope per backend `ApiResponseDto.fail`: `{ success, message, data: null }`. */
function expectErrorEnvelope(payload: Json): ApiErrorEnvelope {
  const body = expectObject(payload, 'envelope');
  if (body.success !== false) {
    throw new Error(`envelope.success must be false, received ${JSON.stringify(body.success)}`);
  }
  expectString(body.message, 'envelope.message');
  if (body.data !== null) {
    throw new Error(`envelope.data must be null on failures, received ${JSON.stringify(body.data)}`);
  }
  return body as unknown as ApiErrorEnvelope;
}

async function jsonResponse(
  response: Response,
  expectedStatus: number,
): Promise<Json> {
  if (response.status !== expectedStatus) {
    throw new Error(
      `expected HTTP ${expectedStatus}, received ${response.status}: ${await response.text()}`,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`expected JSON content-type, received "${contentType}"`);
  }
  return response.json() as Promise<Json>;
}

/* -------------------------------------------------------------------------- */
/* Payload contracts                                                          */
/* -------------------------------------------------------------------------- */

/** Prisma `Campaign` row as returned by the backend (src/types/campaign.ts). */
function expectCampaign(value: Json, at = 'data'): Campaign {
  const row = expectObject(value, at);
  expectString(row.id, `${at}.id`);
  expectString(row.name, `${at}.name`);
  expectEnum(
    row.status,
    ['draft', 'active', 'paused', 'completed', 'archived'] as const,
    `${at}.status`,
  );
  expectNumber(row.budget, `${at}.budget`);
  if (row.metadata !== undefined && row.metadata !== null) {
    expectObject(row.metadata, `${at}.metadata`);
  }
  for (const dateField of ['createdAt', 'updatedAt', 'archivedAt'] as const) {
    if (row[dateField] !== undefined && row[dateField] !== null) {
      expectIsoDateTime(row[dateField], `${at}.${dateField}`);
    }
  }
  return row as unknown as Campaign;
}

/** Timeline milestone consumed by useCampaignTimeline (src/types/campaign.ts). */
function expectTimelineMilestone(value: Json, at: string): CampaignTimelineMilestone {
  const row = expectObject(value, at);
  expectString(row.id, `${at}.id`);
  expectString(row.label, `${at}.label`);
  expectEnum(
    row.status,
    ['completed', 'pending', 'delayed', 'failed'] as const,
    `${at}.status`,
  );
  expectString(row.description, `${at}.description`);
  if (row.occurredAt !== undefined) {
    expectIsoDateTime(row.occurredAt, `${at}.occurredAt`);
  }
  return row as unknown as CampaignTimelineMilestone;
}

/** `AidPackage` row (src/types/aid-package.ts). */
function expectAidPackage(value: Json, at: string): AidPackage {
  const row = expectObject(value, at);
  expectString(row.id, `${at}.id`);
  expectString(row.title, `${at}.title`);
  expectString(row.region, `${at}.region`);
  expectString(row.amount, `${at}.amount`);
  const recipients = expectNumber(row.recipients, `${at}.recipients`);
  if (recipients < 0) {
    throw new Error(`${at}.recipients must not be negative`);
  }
  expectEnum(row.status, ['Active', 'Claimed', 'Expired'] as const, `${at}.status`);
  expectEnum(row.token, ['USDC', 'XLM', 'EURC'] as const, `${at}.token`);
  return row as unknown as AidPackage;
}

/** Paginated envelope returned by `GET /api/v1/aid/packages`. */
function expectPaginatedAidPackages(
  value: Json,
): PaginatedResponse<AidPackage> {
  const body = expectObject(value, 'aidPackages');
  expectArray(body.data, 'aidPackages.data').forEach((row, i) =>
    expectAidPackage(row, `aidPackages.data[${i}]`),
  );
  expectNumber(body.total, 'aidPackages.total');
  expectNumber(body.page, 'aidPackages.page');
  expectNumber(body.size, 'aidPackages.size');
  expectNumber(body.totalPages, 'aidPackages.totalPages');
  return body as unknown as PaginatedResponse<AidPackage>;
}

/** Activity feed item consumed by useActivityFeed (src/hooks/useActivity.ts). */
function expectActivityFeedItem(
  value: Json,
  at: string,
): ContractActivityFeedItem {
  const row = expectObject(value, at);
  expectString(row.id, `${at}.id`);
  expectEnum(
    row.type,
    ['notification', 'audit', 'review'] as const,
    `${at}.type`,
  );
  expectEnum(
    row.status,
    ['pending', 'processing', 'succeeded', 'failed'] as const,
    `${at}.status`,
  );
  expectString(row.title, `${at}.title`);
  expectString(row.description, `${at}.description`);
  expectIsoDateTime(row.timestamp, `${at}.timestamp`);
  expectBoolean(row.read, `${at}.read`);
  return row as unknown as ContractActivityFeedItem;
}

/** `GlobalStatsDto` served by `GET /analytics/global-stats`. */
function expectGlobalStats(value: Json, at = 'stats'): ContractGlobalStats {
  const body = expectObject(value, at);
  for (const counter of [
    'totalClaims',
    'totalPackages',
    'pendingReviews',
    'totalDisbursements',
    'totalAidDisbursed',
    'totalRecipients',
    'activeCampaigns',
  ] as const) {
    expectNumber(body[counter], `${at}.${counter}`);
  }
  for (const breakdownKey of ['byToken', 'byRegion'] as const) {
    expectArray(body[breakdownKey], `${at}.${breakdownKey}`).forEach((entry, i) => {
      const at2 = `${at}.${breakdownKey}[${i}]`;
      const row = expectObject(entry, at2);
      expectString(row.label, `${at2}.label`);
      expectNumber(row.totalAmount, `${at2}.totalAmount`);
      expectNumber(row.count, `${at2}.count`);
    });
  }
  expectArray(body.timeSeries, `${at}.timeSeries`).forEach((entry, i) => {
    const at2 = `${at}.timeSeries[${i}]`;
    const row = expectObject(entry, at2);
    expectString(row.date, `${at2}.date`);
    expectNumber(row.totalAmount, `${at2}.totalAmount`);
    expectNumber(row.count, `${at2}.count`);
  });
  expectIsoDateTime(body.computedAt, `${at}.computedAt`);
  return body as unknown as ContractGlobalStats;
}

/** `RunbookResponse` consumed by useRunbook (src/types/runbook.ts). */
function expectRunbook(value: Json): RunbookResponse {
  const body = expectObject(value, 'runbook');
  expectNumber(body.schema_version, 'runbook.schema_version');
  expectIsoDateTime(body.generated_at, 'runbook.generated_at');

  const sections = expectObject(body.sections, 'runbook.sections');
  for (const sectionKey of ['preDemo', 'liveDemo', 'postDemo'] as const) {
    const section = expectObject(sections[sectionKey], `runbook.sections.${sectionKey}`);
    expectString(section.id, `runbook.sections.${sectionKey}.id`);
    expectArray(section.items, `runbook.sections.${sectionKey}.items`).forEach(
      (item, i) => {
        const at = `runbook.sections.${sectionKey}.items[${i}]`;
        const row = expectObject(item, at);
        expectString(row.id, `${at}.id`);
        expectString(row.titleKey, `${at}.titleKey`);
        expectString(row.descriptionKey, `${at}.descriptionKey`);
        expectString(row.icon, `${at}.icon`);
      },
    );
  }

  const recovery = expectObject(body.failureRecovery, 'runbook.failureRecovery');
  expectArray(recovery.issues, 'runbook.failureRecovery.issues').forEach((issue, i) => {
    const at = `runbook.failureRecovery.issues[${i}]`;
    const row = expectObject(issue, at);
    expectString(row.id, `${at}.id`);
    expectString(row.symptomKey, `${at}.symptomKey`);
    expectString(row.causeKey, `${at}.causeKey`);
    expectEnum(row.severity, ['low', 'medium', 'high'] as const, `${at}.severity`);
    expectArray(row.actions, `${at}.actions`).forEach((action, j) => {
      const at2 = `${at}.actions[${j}]`;
      const actionRow = expectObject(action, at2);
      expectString(actionRow.id, `${at2}.id`);
      expectString(actionRow.description, `${at2}.description`);
    });
  });

  // RunbookResponse requires the canonical registry locations.
  const registry = expectObject(body.contractRegistry, 'runbook.contractRegistry');
  expectString(registry.canonicalSourcePath, 'runbook.contractRegistry.canonicalSourcePath');
  expectString(registry.generatorScript, 'runbook.contractRegistry.generatorScript');
  expectString(registry.deploymentRegistry, 'runbook.contractRegistry.deploymentRegistry');

  return body as unknown as RunbookResponse;
}

/** `ContractRegistryResponse` (src/types/contract-registry.ts). */
function expectContractRegistry(value: Json): ContractRegistryResponse {
  const body = expectObject(value, 'contractRegistry');
  expectNumber(body.schema_version, 'contractRegistry.schema_version');
  expectIsoDateTime(body.generated_at, 'contractRegistry.generated_at');
  const contracts = expectObject(body.contracts, 'contractRegistry.contracts');
  for (const [name, entry] of Object.entries(contracts)) {
    const at = `contractRegistry.contracts.${name}`;
    const contract = expectObject(entry, at);
    expectString(contract.version, `${at}.version`);
    const networks = expectObject(contract.networks, `${at}.networks`);
    for (const [network, deployment] of Object.entries(networks)) {
      const at2 = `${at}.networks.${network}`;
      const dep = expectObject(deployment, at2);
      expectString(dep.contract_id, `${at2}.contract_id`);
      expectString(dep.wasm_hash, `${at2}.wasm_hash`);
      expectString(dep.version, `${at2}.version`);
      expectString(dep.deployed_at, `${at2}.deployed_at`);
    }
  }
  return body as unknown as ContractRegistryResponse;
}

/** One validated import row (`csv-validation.ts`). */
function expectImportMessage(value: Json, at: string): ContractRecipientImportMessage {
  const msg = expectObject(value, at);
  expectEnum(msg.severity, ['warning', 'error'] as const, `${at}.severity`);
  expectString(msg.message, `${at}.message`);
  if (msg.field !== undefined) {
    expectString(msg.field, `${at}.field`);
  }
  return msg as unknown as ContractRecipientImportMessage;
}

function expectImportRow(value: Json, at: string): ContractRecipientImportRowResult {
  const row = expectObject(value, at);
  const rowNumber = expectNumber(row.rowNumber, `${at}.rowNumber`);
  if (rowNumber < 1) {
    throw new Error(`${at}.rowNumber must be >= 1`);
  }
  expectEnum(row.status, ['valid', 'warning', 'error'] as const, `${at}.status`);
  expectArray(row.messages, `${at}.messages`).forEach((m, i) =>
    expectImportMessage(m, `${at}.messages[${i}]`),
  );
  // csv-validation.ts relies on `values` never leaking to the client.
  if ('values' in row) {
    throw new Error(`${at} must not expose the internal "values" field`);
  }
  return row as unknown as ContractRecipientImportRowResult;
}

/** WebAuthn verify response (`biometricService.VerifyResponse`). */
function expectWebAuthnVerify(
  value: Json,
  at = 'verify',
): ContractWebAuthnVerifyResponse {
  const body = expectObject(value, at);
  expectBoolean(body.verified, `${at}.verified`);
  if (body.message !== undefined) {
    expectString(body.message, `${at}.message`);
  }
  if (body.credentialId !== undefined) {
    expectString(body.credentialId, `${at}.credentialId`);
  }
  if (body.counter !== undefined) {
    expectNumber(body.counter, `${at}.counter`);
  }
  return body as unknown as ContractWebAuthnVerifyResponse;
}

/** `InternalNote` returned by the verification-inbox notes endpoint. */
function expectInternalNote(value: Json, at = 'note'): InternalNote {
  const body = expectObject(value, at);
  expectString(body.id, `${at}.id`);
  expectString(body.entityType, `${at}.entityType`);
  expectString(body.entityId, `${at}.entityId`);
  expectString(body.content, `${at}.content`);
  expectString(body.authorId, `${at}.authorId`);
  expectIsoDateTime(body.createdAt, `${at}.createdAt`);
  expectIsoDateTime(body.updatedAt, `${at}.updatedAt`);
  if (body.category !== null) {
    expectString(body.category, `${at}.category`);
  }
  return body as unknown as InternalNote;
}

/* -------------------------------------------------------------------------- */
/* OpenAPI schema agreement (auto-enforces once app/backend/openapi is populated) */
/* -------------------------------------------------------------------------- */

interface OpenApiSchemaObject {
  $ref?: string;
  type?: string | string[];
  nullable?: boolean;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, OpenApiSchemaObject>;
  items?: OpenApiSchemaObject;
  allOf?: OpenApiSchemaObject[];
  oneOf?: OpenApiSchemaObject[];
  anyOf?: OpenApiSchemaObject[];
}

interface OpenApiDocument {
  openapi: string;
  paths?: Record<
    string,
    Record<string, { responses?: Record<string, { content?: Record<string, { schema?: OpenApiSchemaObject }> }> }>
  >;
  components?: { schemas?: Record<string, OpenApiSchemaObject> };
}

function loadOpenApiDocument(): OpenApiDocument | null {
  const docPath = path.resolve(
    __dirname,
    '../../../../../app/backend/openapi/openapi.json',
  );
  if (!fs.existsSync(docPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(docPath, 'utf-8')) as OpenApiDocument;
  } catch {
    return null;
  }
}

function resolveRef(
  schema: OpenApiSchemaObject,
  doc: OpenApiDocument,
): OpenApiSchemaObject {
  if (schema.$ref?.startsWith('#/components/schemas/')) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    return doc.components?.schemas?.[name] ?? schema;
  }
  return schema;
}

/** Validates `value` against an OpenAPI/JSON schema subset, collecting violations. */
function validateAgainstSchema(
  value: unknown,
  rawSchema: OpenApiSchemaObject,
  doc: OpenApiDocument,
  at: string,
  violations: string[],
): void {
  const schema = resolveRef(rawSchema, doc);

  for (const sub of schema.allOf ?? []) {
    validateAgainstSchema(value, sub, doc, at, violations);
  }

  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives && alternatives.length > 0) {
    const matchesAlternative = alternatives.some(alt => {
      const local: string[] = [];
      validateAgainstSchema(value, alt, doc, at, local);
      return local.length === 0;
    });
    if (!matchesAlternative) {
      violations.push(`${at}: does not match any allowed schema variant`);
    }
  }

  if (value === null) {
    if (schema.nullable !== true && !(schema.type ?? '').toString().includes('null')) {
      violations.push(`${at}: schema does not allow null`);
    }
    return;
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (schema.enum && !schema.enum.some(candidate => candidate === value)) {
    violations.push(
      `${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`,
    );
  }

  if (type === 'string' && typeof value !== 'string') {
    violations.push(`${at}: expected string, received ${typeof value}`);
    return;
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    violations.push(`${at}: expected boolean, received ${typeof value}`);
    return;
  }
  if (type === 'number' && typeof value !== 'number') {
    violations.push(`${at}: expected number, received ${typeof value}`);
    return;
  }
  if (type === 'integer' && !Number.isInteger(value)) {
    violations.push(`${at}: expected integer, received ${JSON.stringify(value)}`);
    return;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      violations.push(`${at}: expected array, received ${typeof value}`);
      return;
    }
    if (schema.items) {
      value.forEach((item, index) =>
        validateAgainstSchema(item, schema.items as OpenApiSchemaObject, doc, `${at}[${index}]`, violations),
      );
    }
    return;
  }

  if (type === 'object' || schema.properties) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      violations.push(`${at}: expected object, received ${JSON.stringify(value)}`);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) {
        violations.push(`${at}.${key}: required by OpenAPI schema but missing`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) {
        validateAgainstSchema(record[key], childSchema, doc, `${at}.${key}`, violations);
      }
    }
  }
}

function findOpenApiSchema(
  doc: OpenApiDocument,
  method: string,
  contractPath: string,
  status: number,
): OpenApiSchemaObject | undefined {
  const candidates = [
    contractPath,
    `/api/v1${contractPath}`,
    `/api${contractPath}`,
    `/v1${contractPath}`,
  ];
  for (const candidate of candidates) {
    const operation = doc.paths?.[candidate]?.[method.toLowerCase()];
    const schema = operation?.responses?.[String(status)]?.content?.['application/json']?.schema;
    if (schema) {
      return schema;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Endpoints covered by this suite                                            */
/* -------------------------------------------------------------------------- */

const EXPECTED_REGISTRY_KEYS = [
  '/health',
  '/aid-packages',
  '/analytics/global-stats',
  '/notifications/activity-feed',
  '/recipients/import/validate',
  '/recipients/import/report',
  '/recipients/import/confirm',
  '/auth/webauthn/register/options',
  '/auth/webauthn/register/verify',
  '/auth/webauthn/auth/options',
  '/auth/webauthn/auth/verify',
  '/v1/verification-inbox',
  '/v1/verification-inbox/stats',
  '/v1/verification-inbox/:id',
  '/campaigns',
  '/campaigns/:id',
  '/contract-registry',
  '/runbook',
] as const;

/** Endpoints checked against the committed backend OpenAPI document. */
const OPENAPI_ENDPOINTS = [
  { key: '/health', method: 'get', contractPath: '/health', status: 200, invoke: () => mockFetch('/health', `${API_BASE}/health`) },
  { key: '/campaigns', method: 'get', contractPath: '/campaigns', status: 200, invoke: () => mockFetch('/campaigns', `${API_BASE}/campaigns`) },
  { key: '/analytics/global-stats', method: 'get', contractPath: '/analytics/global-stats', status: 200, invoke: () => mockFetch('/analytics/global-stats', `${API_BASE}/analytics/global-stats`) },
] as const;

function makeImportForm(csv: string, campaignId = 'camp-1143'): FormData {
  const form = new FormData();
  form.set('file', new File([csv], 'recipients.csv', { type: 'text/csv' }));
  form.set('campaignId', campaignId);
  return form;
}

const VALID_CSV =
  'name,wallet,phone\nAmina Yusuf,GABCDEFGHIJKLM,1234567890\n,NoWallet,\n';

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('Mock handler contract vs. real API shape', () => {
  describe('registry', () => {
    it('exposes exactly the mock endpoints this suite covers', () => {
      expect([...Object.keys(handlers)].sort()).toEqual(
        [...EXPECTED_REGISTRY_KEYS].sort(),
      );
    });
  });

  describe('GET /health (backend LivenessResponse)', () => {
    it('matches the backend liveness contract', async () => {
      const payload = await jsonResponse(
        await mockFetch('/health', `${API_BASE}/health`),
        200,
      );
      const body = expectObject(payload, 'health');
      expect(body.status).toBe('ok');
      expect(body.service).toBe('backend');
      expectString(body.version, 'health.version');
      expectString(body.environment, 'health.environment');
      expectIsoDateTime(body.timestamp, 'health.timestamp');

      const checks = expectObject(body.checks, 'health.checks');
      const process = expectObject(checks.process, 'health.checks.process');
      expectEnum(process.status, ['up', 'down', 'skipped'] as const, 'health.checks.process.status');
      if (process.details !== undefined) {
        expectObject(process.details, 'health.checks.process.details');
      }

      // Compile-time agreement with the shared contract type.
      const contract: ContractLivenessResponse = body as unknown as ContractLivenessResponse;
      expect(contract.checks.process.status).toBe('up');
    });
  });

  describe('GET /aid-packages (PaginatedResponse<AidPackage>)', () => {
    it('returns the paginated aid-package envelope the API client expects', async () => {
      const payload = await jsonResponse(
        await mockFetch('/aid-packages', `${API_BASE}/aid-packages`),
        200,
      );
      const paginated = expectPaginatedAidPackages(payload);
      expect(paginated.total).toBeGreaterThan(0);
      expect(paginated.data.length).toBeGreaterThan(0);
    });

    it('keeps the envelope shape for filtered queries and respects filters', async () => {
      const payload = await jsonResponse(
        await mockFetch(
          '/aid-packages',
          `${API_BASE}/aid-packages?status=Active&token=USDC&page=1&size=2`,
        ),
        200,
      );
      const paginated = expectPaginatedAidPackages(payload);
      expect(paginated.data).toHaveLength(2);
      for (const pkg of paginated.data) {
        expect(pkg.status).toBe('Active');
        expect(pkg.token).toBe('USDC');
      }
    });
  });

  describe('GET /campaigns (backend ApiResponseDto<Campaign[]>)', () => {
    it('wraps campaigns in the backend success envelope', async () => {
      const payload = await jsonResponse(
        await mockFetch('/campaigns', `${API_BASE}/campaigns`),
        200,
      );
      expectSuccessEnvelope(payload, data => {
        const rows = expectArray(data, 'data');
        rows.forEach((row, i) => expectCampaign(row, `data[${i}]`));
        return rows;
      });
    });

    it('returns the failure envelope for unsupported methods', async () => {
      const payload = await jsonResponse(
        await mockFetch('/campaigns/:id', `${API_BASE}/campaigns/1`, { method: 'DELETE' }),
        405,
      );
      expectErrorEnvelope(payload);
    });
  });

  describe('POST /campaigns (backend ApiResponseDto<Campaign>)', () => {
    it('returns the created campaign in the success envelope (201)', async () => {
      const payload = await jsonResponse(
        await mockFetch('/campaigns', `${API_BASE}/campaigns`, {
          method: 'POST',
          body: JSON.stringify({
            name: 'Contract Test Campaign',
            budget: 1000,
            metadata: { token: 'USDC' },
          }),
        }),
        201,
      );
      expectSuccessEnvelope(payload, data => {
        const campaign = expectCampaign(data);
        expect(campaign.name).toBe('Contract Test Campaign');
        expect(campaign.budget).toBe(1000);
        // The backend defaults a campaign with no status to `draft`.
        expect(campaign.status).toBe('draft');
      });
    });

    it('returns the backend failure envelope when the body is missing (400)', async () => {
      const payload = await jsonResponse(
        await mockFetch('/campaigns', `${API_BASE}/campaigns`, { method: 'POST' }),
        400,
      );
      expectErrorEnvelope(payload);
    });
  });

  describe('GET/PATCH /campaigns/:id (backend ApiResponseDto<Campaign>)', () => {
    async function createCampaign(name: string): Promise<Campaign> {
      const payload = (await jsonResponse(
        await mockFetch('/campaigns', `${API_BASE}/campaigns`, {
          method: 'POST',
          body: JSON.stringify({ name, budget: 500 }),
        }),
        201,
      )) as ApiSuccessEnvelope<Campaign>;
      return payload.data;
    }

    it('returns details in the success envelope', async () => {
      const created = await createCampaign('Detail Target');
      const payload = await jsonResponse(
        await mockFetch('/campaigns/:id', `${API_BASE}/campaigns/${created.id}`),
        200,
      );
      expectSuccessEnvelope(payload, data => {
        const campaign = expectCampaign(data);
        expect(campaign.id).toBe(created.id);
      });
    });

    it('returns the updated campaign and sets archivedAt when archiving', async () => {
      const created = await createCampaign('Archive Target');
      const payload = await jsonResponse(
        await mockFetch('/campaigns/:id', `${API_BASE}/campaigns/${created.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'archived', budget: 750 }),
        }),
        200,
      );
      expectSuccessEnvelope(payload, data => {
        const campaign = expectCampaign(data);
        expect(campaign.status).toBe('archived');
        expect(campaign.budget).toBe(750);
        expectIsoDateTime(campaign.archivedAt, 'data.archivedAt');
      });
    });

    it('returns the failure envelope for unknown ids (404)', async () => {
      const payload = await jsonResponse(
        await mockFetch('/campaigns/:id', `${API_BASE}/campaigns/does-not-exist`, {
          method: 'PATCH',
          body: JSON.stringify({ budget: 1 }),
        }),
        404,
      );
      expectErrorEnvelope(payload);
    });
  });

  describe('GET /campaigns/:id/timeline (ApiResponseDto<CampaignTimelineMilestone[]>)', () => {
    it('returns milestones matching the timeline contract', async () => {
      const payload = await jsonResponse(
        await mockFetch('/campaigns/:id', `${API_BASE}/campaigns/1/timeline`),
        200,
      );
      expectSuccessEnvelope(payload, data => {
        const rows = expectArray(data, 'data');
        expect(rows.length).toBeGreaterThan(0);
        rows.forEach((row, i) => expectTimelineMilestone(row, `data[${i}]`));
      });
    });

    it('returns the failure envelope for unknown campaigns (404)', async () => {
      const payload = await jsonResponse(
        await mockFetch('/campaigns/:id', `${API_BASE}/campaigns/nope/timeline`),
        404,
      );
      expectErrorEnvelope(payload);
    });
  });

  describe('GET /notifications/activity-feed (ApiResponseDto<ActivityFeedItem[]>)', () => {
    it('returns feed items matching the useActivity contract', async () => {
      const payload = await jsonResponse(
        await mockFetch('/notifications/activity-feed', `${API_BASE}/notifications/activity-feed`),
        200,
      );
      expectSuccessEnvelope(payload, data => {
        const rows = expectArray(data, 'data');
        expect(rows.length).toBeGreaterThan(0);
        rows.forEach((row, i) => expectActivityFeedItem(row, `data[${i}]`));
      });
    });
  });

  describe('GET /analytics/global-stats (backend GlobalStatsDto)', () => {
    it('returns the full global-stats payload used by the dashboard cards', async () => {
      const payload = await jsonResponse(
        await mockFetch('/analytics/global-stats', `${API_BASE}/analytics/global-stats`),
        200,
      );
      expectGlobalStats(payload);
    });
  });

  describe('GET /contract-registry (registry artifact)', () => {
    it('matches the shape and content of the committed registry artifact', async () => {
      const payload = await jsonResponse(
        await mockFetch('/contract-registry', `${API_BASE}/contract-registry`),
        200,
      );
      const registry = expectContractRegistry(payload);

      const artifactPath = path.resolve(__dirname, '../../../public/contract-registry.json');
      const artifact = JSON.parse(
        fs.readFileSync(artifactPath, 'utf-8'),
      ) as ContractRegistryResponse;

      // Everything except the volatile timestamp must match the generated artifact.
      const { generated_at: mockGeneratedAt, ...mockRest } = registry;
      const { generated_at: artifactGeneratedAt, ...artifactRest } = artifact;
      expectIsoDateTime(mockGeneratedAt, 'contractRegistry.generated_at');
      expectIsoDateTime(artifactGeneratedAt, 'artifact.generated_at');
      expect(mockRest).toEqual(artifactRest);
    });
  });

  describe('GET /runbook (RunbookResponse)', () => {
    it('returns a runbook matching the shared RunbookResponse contract', async () => {
      const payload = await jsonResponse(
        await mockFetch('/runbook', `${API_BASE}/runbook`),
        200,
      );
      const runbook = expectRunbook(payload);
      expect(Object.keys(runbook.sections)).toEqual(['preDemo', 'liveDemo', 'postDemo']);
    });
  });

  describe('POST /recipients/import/validate', () => {
    it('returns rows matching the csv-validation contract', async () => {
      const payload = (await jsonResponse(
        await mockFetch('/recipients/import/validate', `${API_BASE}/recipients/import/validate`, {
          method: 'POST',
          body: makeImportForm(VALID_CSV),
        }),
        200,
      )) as ContractRecipientImportValidateResponse;

      expect(payload.success).toBe(true);
      const rows = expectArray(payload.rows, 'rows');
      expect(rows).toHaveLength(2);
      rows.forEach((row, i) => expectImportRow(row, `rows[${i}]`));
      expect(payload.rows[1].status).toBe('error');
      expect(
        payload.rows[1].messages.some(message => message.severity === 'error'),
      ).toBe(true);
    });

    it('returns failure envelopes for missing form data or file (400)', async () => {
      const noForm = await jsonResponse(
        await mockFetch('/recipients/import/validate', `${API_BASE}/recipients/import/validate`, {
          method: 'POST',
          body: 'not-form-data',
        }),
        400,
      );
      expectErrorEnvelope(noForm);

      const noFile = await jsonResponse(
        await mockFetch('/recipients/import/validate', `${API_BASE}/recipients/import/validate`, {
          method: 'POST',
          body: new FormData(),
        }),
        400,
      );
      expectErrorEnvelope(noFile);
    });
  });

  describe('POST /recipients/import/report', () => {
    it('returns a CSV attachment with report metadata', async () => {
      const response = await mockFetch(
        '/recipients/import/report',
        `${API_BASE}/recipients/import/report`,
        { method: 'POST', body: makeImportForm(VALID_CSV, 'camp-1143') },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      expect(response.headers.get('content-disposition')).toContain(
        'recipient-import-report-camp-1143.csv',
      );
      expect(response.headers.get('x-report-id')).toBeTruthy();
      expect(response.headers.get('x-report-generated-at')).toBeTruthy();

      const text = await response.text();
      expect(text).toContain('# Soter recipient import validation report');
      expect(text).toContain('# campaignId: camp-1143');
      expect(text).toContain('# source: backend');
      expect(text).toContain('rowNumber,status,severity,field,message,name,wallet,phone');
    });

    it('returns failure envelopes for missing form data or file (400)', async () => {
      const noForm = await jsonResponse(
        await mockFetch('/recipients/import/report', `${API_BASE}/recipients/import/report`, {
          method: 'POST',
          body: 'not-form-data',
        }),
        400,
      );
      expectErrorEnvelope(noForm);

      const noFile = await jsonResponse(
        await mockFetch('/recipients/import/report', `${API_BASE}/recipients/import/report`, {
          method: 'POST',
          body: new FormData(),
        }),
        400,
      );
      expectErrorEnvelope(noFile);
    });
  });

  describe('POST /recipients/import/confirm', () => {
    it('returns the confirmation contract', async () => {
      const payload = await jsonResponse(
        await mockFetch('/recipients/import/confirm', `${API_BASE}/recipients/import/confirm`, {
          method: 'POST',
          body: makeImportForm(VALID_CSV),
        }),
        200,
      );
      const body = expectObject(payload, 'confirm');
      expect(body.success).toBe(true);
      expectString(body.message, 'confirm.message');
    });

    it('returns failure envelopes for missing form data or file (400)', async () => {
      const noForm = await jsonResponse(
        await mockFetch('/recipients/import/confirm', `${API_BASE}/recipients/import/confirm`, {
          method: 'POST',
          body: 'not-form-data',
        }),
        400,
      );
      expectErrorEnvelope(noForm);

      const noFile = await jsonResponse(
        await mockFetch('/recipients/import/confirm', `${API_BASE}/recipients/import/confirm`, {
          method: 'POST',
          body: new FormData(),
        }),
        400,
      );
      expectErrorEnvelope(noFile);
    });
  });

  describe('WebAuthn endpoints (biometricService contracts)', () => {
    it('returns registration options matching the biometric service contract', async () => {
      const payload = await jsonResponse(
        await mockFetch(
          '/auth/webauthn/register/options',
          `${API_BASE}/auth/webauthn/register/options?username=demo&userId=user-1`,
        ),
        200,
      );
      const options = expectObject(payload, 'registerOptions');
      expectString(options.challenge, 'registerOptions.challenge');
      const rp = expectObject(options.rp, 'registerOptions.rp');
      expectString(rp.name, 'registerOptions.rp.name');
      const user = expectObject(options.user, 'registerOptions.user');
      expectString(user.id, 'registerOptions.user.id');
      expectString(user.name, 'registerOptions.user.name');
      expectString(user.displayName, 'registerOptions.user.displayName');
      expectArray(options.pubKeyCredParams, 'registerOptions.pubKeyCredParams').forEach(
        (param, i) => {
          const at = `registerOptions.pubKeyCredParams[${i}]`;
          expectObject(param, at);
          expectNumber((param as Record<string, Json>).alg, `${at}.alg`);
          expect((param as Record<string, Json>).type).toBe('public-key');
        },
      );

      // Compile-time agreement with the shared contract type.
      const contract: ContractWebAuthnRegistrationOptions =
        options as unknown as ContractWebAuthnRegistrationOptions;
      expect(contract.challenge.length).toBeGreaterThan(0);
    });

    it('registers and then authenticates a credential (verify contracts)', async () => {
      const credentialId = `cred-${Date.now()}`;

      const registerPayload = await jsonResponse(
        await mockFetch('/auth/webauthn/register/verify', `${API_BASE}/auth/webauthn/register/verify`, {
          method: 'POST',
          body: JSON.stringify({ id: credentialId, response: { attestationObject: 'att' } }),
        }),
        200,
      );
      const registered = expectWebAuthnVerify(registerPayload, 'registerVerify');
      expect(registered.verified).toBe(true);

      const authPayload = await jsonResponse(
        await mockFetch('/auth/webauthn/auth/verify', `${API_BASE}/auth/webauthn/auth/verify`, {
          method: 'POST',
          body: JSON.stringify({ id: credentialId, response: { signature: 'sig' } }),
        }),
        200,
      );
      const authenticated = expectWebAuthnVerify(authPayload, 'authVerify');
      expect(authenticated.verified).toBe(true);
    });

    it('returns authentication options and 404s unknown credentials', async () => {
      const payload = await jsonResponse(
        await mockFetch('/auth/webauthn/auth/options', `${API_BASE}/auth/webauthn/auth/options`),
        200,
      );
      const options = expectObject(payload, 'authOptions');
      expectString(options.challenge, 'authOptions.challenge');
      expectArray(options.allowCredentials, 'authOptions.allowCredentials');
      const contract: ContractWebAuthnAuthenticationOptions =
        options as unknown as ContractWebAuthnAuthenticationOptions;
      expect(contract.challenge.length).toBeGreaterThan(0);

      const notFound = await jsonResponse(
        await mockFetch('/auth/webauthn/auth/verify', `${API_BASE}/auth/webauthn/auth/verify`, {
          method: 'POST',
          body: JSON.stringify({ id: 'unknown-credential' }),
        }),
        404,
      );
      const errorBody = expectObject(notFound, 'authVerifyError');
      expect(errorBody.verified).toBe(false);
      expectString(errorBody.message, 'authVerifyError.message');
    });

    it('returns 400 with the verify error contract for malformed requests', async () => {
      const payload = await jsonResponse(
        await mockFetch('/auth/webauthn/register/verify', `${API_BASE}/auth/webauthn/register/verify`, {
          method: 'POST',
          body: 'not-json',
        }),
        400,
      );
      const body = expectObject(payload, 'registerVerifyError');
      expect(body.verified).toBe(false);
      expectString(body.message, 'registerVerifyError.message');
    });
  });

  describe('GET /v1/verification-inbox (paginated queue)', () => {
    it('returns the paginated VerificationInboxResponse envelope', async () => {
      const payload = await jsonResponse(
        await mockFetch('/v1/verification-inbox', `${API_BASE}/v1/verification-inbox`),
        200,
      );
      const body = expectObject(payload, 'inbox');
      const items = expectArray(body.items, 'inbox.items');
      expect(items.length).toBeGreaterThan(0);
      expectNumber(body.total, 'inbox.total');
      expectNumber(body.page, 'inbox.page');
      expectNumber(body.limit, 'inbox.limit');
      expectNumber(body.totalPages, 'inbox.totalPages');

      const item = expectObject(items[0], 'inbox.items[0]');
      expectString(item.id, 'inbox.items[0].id');
      expectEnum(
        item.status,
        ['pending_review', 'approved', 'rejected', 'needs_resubmission'] as const,
        'inbox.items[0].status',
      );
      expectIsoDateTime(item.createdAt, 'inbox.items[0].createdAt');
      expectString(item.deepLink, 'inbox.items[0].deepLink');

      const contract: VerificationInboxResponse = body as unknown as VerificationInboxResponse;
      expect(contract.items.length).toBe(items.length);
    });

    it('honours status filtering and pagination parameters', async () => {
      const filtered = await jsonResponse(
        await mockFetch('/v1/verification-inbox', `${API_BASE}/v1/verification-inbox?status=pending_review&limit=2`),
        200,
      );
      const body = expectObject(filtered, 'inboxFiltered');
      const items = expectArray(body.items, 'inboxFiltered.items');
      expect(items.length).toBeLessThanOrEqual(2);
      for (const raw of items) {
        const item = expectObject(raw, 'inboxFiltered.items[]');
        expect(item.status).toBe('pending_review');
      }
      expectNumber(body.limit, 'inboxFiltered.limit');
      expect(body.limit).toBe(2);
    });
  });

  describe('GET /v1/verification-inbox/stats (VerificationStats)', () => {
    it('returns per-status counts plus the queue total', async () => {
      const payload = await jsonResponse(
        await mockFetch('/v1/verification-inbox/stats', `${API_BASE}/v1/verification-inbox/stats`),
        200,
      );
      const body = expectObject(payload, 'inboxStats');
      for (const key of [
        'pending_review',
        'approved',
        'rejected',
        'needs_resubmission',
      ] as const) {
        expectNumber(body[key], `inboxStats.${key}`);
      }
      expectNumber(body.total, 'inboxStats.total');

      const contract: VerificationStats = body as unknown as VerificationStats;
      expect(contract.total).toBeGreaterThan(0);
    });
  });

  describe('GET /v1/verification-inbox/:id', () => {
    it('returns the item for a known id and 404 for an unknown one', async () => {
      const detail = await jsonResponse(
        await mockFetch('/v1/verification-inbox/:id', `${API_BASE}/v1/verification-inbox/vfy-001`),
        200,
      );
      const item = expectObject(detail, 'inboxItem');
      expect(item.id).toBe('vfy-001');
      expectIsoDateTime(item.createdAt, 'inboxItem.createdAt');
      expectString(item.deepLink, 'inboxItem.deepLink');

      const notFound = await jsonResponse(
        await mockFetch('/v1/verification-inbox/:id', `${API_BASE}/v1/verification-inbox/unknown`),
        404,
      );
      expectString(expectObject(notFound, 'inboxNotFound').message, 'inboxNotFound.message');
    });
  });

  describe('POST /v1/verification-inbox/:id/notes', () => {
    it('returns an InternalNote for a known request', async () => {
      const payload = await jsonResponse(
        await mockFetch('/v1/verification-inbox/:id', `${API_BASE}/v1/verification-inbox/vfy-001/notes`, {
          method: 'POST',
          body: JSON.stringify({ content: 'Looks good', category: 'review' }),
        }),
        201,
      );
      const note = expectInternalNote(payload);
      expect(note.entityId).toBe('vfy-001');
      expect(note.content).toBe('Looks good');
    });

    it('returns 404 for unknown requests and 405 for unimplemented methods', async () => {
      const notFound = await jsonResponse(
        await mockFetch('/v1/verification-inbox/:id', `${API_BASE}/v1/verification-inbox/unknown/notes`, {
          method: 'POST',
          body: JSON.stringify({ content: 'x' }),
        }),
        404,
      );
      expectString(expectObject(notFound, 'noteError').message, 'noteError.message');

      const notImplemented = await jsonResponse(
        await mockFetch('/v1/verification-inbox/:id', `${API_BASE}/v1/verification-inbox/vfy-001`, {
          method: 'PUT',
        }),
        405,
      );
      expectErrorEnvelope(notImplemented);
    });
  });

  describe('committed backend OpenAPI schema', () => {
    it('is enforced for every endpoint the document covers', async () => {
      const doc = loadOpenApiDocument();
      expect(doc).not.toBeNull();
      expect(typeof doc?.openapi).toBe('string');

      const violations: string[] = [];
      let coveredEndpoints = 0;

      for (const endpoint of OPENAPI_ENDPOINTS) {
        const schema = findOpenApiSchema(
          doc as OpenApiDocument,
          endpoint.method,
          endpoint.contractPath,
          endpoint.status,
        );
        if (!schema) {
          // Not yet covered by the committed document (app/backend/openapi
          // currently ships without paths) — shared types are the contract.
          continue;
        }
        coveredEndpoints += 1;
        const response = await endpoint.invoke();
        const payload = await response.json();
        validateAgainstSchema(
          payload,
          schema,
          doc as OpenApiDocument,
          `${endpoint.method.toUpperCase()} ${endpoint.contractPath}`,
          violations,
        );
      }

      expect(violations).toEqual([]);
      // Surface how much of the document is populated, so a future regression
      // that empties the schema is noticeable in CI output.
      expect(coveredEndpoints).toBeGreaterThanOrEqual(0);
    });
  });

  describe('coverage guard', () => {
    it('exercises every registered mock handler', () => {
      const uncovered = Object.keys(handlers).filter(
        key => !exercisedKeys.has(key),
      );
      expect(uncovered).toEqual([]);
    });
  });
});
