# Implementation Plan: Seeded Demo Tenant and Sandbox Admin Endpoints

## Overview

Implement a protected sandbox subsystem in the NestJS backend. The work is broken into: seed shape constants, the guard, the service, the controller, the module wiring, and tests.

## Tasks

- [x] 1. Create seed shape constants file
  - Create `src/sandbox/demo-seeds.constants.ts` with `DemoTenantSeed`, `DemoCampaignSeed`, and `DemoClaimSeed` interfaces
  - Export `DEMO_TENANT_SEED` with fixed `ngoId: "demo-ngo-seed-001"`, `name`, `description`, and `region` fields
  - Export `DEMO_CAMPAIGN_SEEDS` array with ≥4 entries covering `draft`, `active`, `paused`, and `completed` statuses, each with `metadata: { region, partner }` fields
  - Export `DEMO_CLAIM_SEEDS` array with ≥3 entries covering `requested`, `verified`, and `approved` statuses; at least one entry must include `evidenceRef`; `campaignName` fields must reference `DEMO_CAMPAIGN_SEEDS[n].name` by variable, not hardcoded string
  - Add top-level file JSDoc warning that these shapes are sandbox-only and must not be imported in production code paths
  - Add JSDoc block on each exported constant describing its purpose, fields, and extension instructions
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 4.2, 4.5, 5.2, 5.6, 3.2_

- [x] 2. Implement SandboxGuard
  - [x] 2.1 Create `src/sandbox/sandbox.guard.ts` implementing `CanActivate`
    - Read `process.env.SANDBOX_ENABLED` directly (no `ConfigService`)
    - Return `true` when value is exactly `"true"`, otherwise throw `ForbiddenException`
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [ ]\* 2.2 Write property test for SandboxGuard (Property 1)
    - Create `src/sandbox/sandbox.guard.spec.ts`
    - Install `fast-check` if not present: `npm install --save-dev fast-check`
    - **Property 1: SandboxGuard blocks all non-"true" SANDBOX_ENABLED values**
    - Use `fc.oneof(fc.constant(undefined), fc.string().filter(s => s !== 'true'))` to generate invalid values
    - Assert `guard.canActivate(mockContext)` throws `ForbiddenException` for all generated values
    - Also assert `"true"` returns `true`
    - Tag: `// Feature: seeded-demo-tenant-sandbox, Property 1: SandboxGuard blocks all non-"true" SANDBOX_ENABLED values`
    - `{ numRuns: 100 }`
    - **Validates: Requirements 1.1, 1.2, 1.5**

- [x] 3. Implemhient SeedService
  - [x] 3.1 Create `src/sandbox/seed.service.ts` with `PrismaService` injection
    - Implement `seedTenant()`: upsert the `__demo_tenant_marker__` campaign under `DEMO_TENANT_SEED.ngoId`; return `{ ngoId, created: boolean }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Implement `seedCampaigns()` in `SeedService`
    - For each entry in `DEMO_CAMPAIGN_SEEDS`, check existence by `name` + `ngoId`; create if absent, skip if present
    - Return `{ created: number, skipped: number, campaignIds: string[] }`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 3.3 Implement `seedClaims()` in `SeedService`
    - Resolve each `DemoClaimSeed.campaignName` to a `campaignId` via DB lookup; throw `UnprocessableEntityException` (HTTP 422) with descriptive message if campaign not found
    - Check existence by `recipientRef` + `campaignId`; create if absent, skip if present
    - Return `{ created: number, skipped: number, claimIds: string[] }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.4 Implement `seedAll()` and `resetSeed()` in `SeedService`
    - `seedAll()`: call `seedTenant()`, then `seedCampaigns()`, then `seedClaims()` in order; return `{ tenant, campaigns, claims }`; on any step failure, throw `InternalServerErrorException` identifying the failing step
    - `resetSeed()`: delete all claims, campaigns, and the tenant marker identified by `DEMO_TENANT_SEED.ngoId` and seed shape markers; return `{ deletedClaims, deletedCampaigns, deletedTenants }`; return zero counts when nothing exists; must not delete non-seeded records
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

  - [ ]\* 3.5 Write property tests for SeedService idempotency (Properties 2–4, 6–7)
    - Create `src/sandbox/seed.service.spec.ts` (property-based section)
    - **Property 2: Tenant seed idempotency** — call `seedTenant()` N times, assert exactly one marker record exists and all calls after the first return `created: false`; tag and `{ numRuns: 100 }`; **Validates: Requirements 3.3, 3.4, 3.5**
    - **Property 3: Campaign seed idempotency** — call `seedCampaigns()` N times, assert exactly `|DEMO_CAMPAIGN_SEEDS|` records exist and subsequent calls return `created: 0`; **Validates: Requirements 4.3, 4.4**
    - **Property 4: Claim seed idempotency** — call `seedClaims()` N times (campaigns pre-seeded), assert exactly `|DEMO_CLAIM_SEEDS|` claim records and subsequent calls return `created: 0`; **Validates: Requirements 5.4, 5.5**
    - **Property 6: Full seed idempotency** — call `seedAll()` N times, assert total seeded record count does not grow beyond first call; **Validates: Requirements 6.4**
    - **Property 7: Reset preserves non-seeded records** — insert random non-seeded campaigns under a different `ngoId`, call `seedAll()` then `resetSeed()`, assert non-seeded records remain intact; **Validates: Requirements 7.1, 7.4**

  - [ ]\* 3.6 Write unit tests for SeedService
    - Mock `PrismaService` with `jest-mock-extended`
    - Test `seedTenant` creates on first call and skips on second
    - Test `seedCampaigns` idempotency with mocked DB responses
    - Test `seedClaims` throws 422 when campaign lookup returns null
    - Test `resetSeed` returns correct counts
    - Test `seedAll` wraps step failure as 500 with step name in message
    - _Requirements: 3.3, 4.3, 5.3, 6.2, 7.2_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement SandboxController
  - [x] 5.1 Create `src/sandbox/sandbox.controller.ts`
    - Mount at `@Controller({ path: 'admin/sandbox', version: '1' })`
    - Apply `@Roles(AppRole.admin)` and `@UseGuards(SandboxGuard)` to the controller class
    - Implement `POST /seed/tenant` → `seedService.seedTenant()`
    - Implement `POST /seed/campaigns` → `seedService.seedCampaigns()`
    - Implement `POST /seed/claims` → `seedService.seedClaims()`
    - Implement `POST /seed` → `seedService.seedAll()`; catch errors and re-throw as `InternalServerErrorException` with step name
    - Implement `DELETE /seed` → `seedService.resetSeed()`
    - _Requirements: 2.1, 2.2, 2.3, 6.2_

  - [ ]\* 5.2 Write unit tests for SandboxController
    - Create `src/sandbox/sandbox.controller.spec.ts`
    - Test each endpoint delegates to the correct service method and returns its result
    - Test `POST /seed` wraps service error as 500 with step name
    - **Property 5: Full seed response shape** — assert `seedAll()` response always contains non-null `tenant`, `campaigns`, and `claims` keys with correct structure; tag: `// Feature: seeded-demo-tenant-sandbox, Property 5: Full seed response shape`; **Validates: Requirements 6.3**
    - _Requirements: 2.1, 2.2, 2.3, 6.2, 6.3_

- [x] 6. Wire up SandboxModule and register in AppModule
  - Create `src/sandbox/sandbox.module.ts` with `imports: [PrismaModule]`, `controllers: [SandboxController]`, `providers: [SeedService, SandboxGuard]`
  - Import `SandboxModule` into `AppModule`
  - _Requirements: 1.4_

- [x] 7. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- `fast-check` is required for property tests: `npm install --save-dev fast-check`
- All property tests use `{ numRuns: 100 }` and are tagged with `// Feature: seeded-demo-tenant-sandbox, Property N: ...`
- `SandboxGuard` reads `process.env.SANDBOX_ENABLED` directly — no `ConfigService` injection
- The "demo tenant" has no separate DB model; it is represented by a sentinel campaign (`__demo_tenant_marker__`) under `ngoId: "demo-ngo-seed-001"`
- `resetSeed` must only delete records identifiable by seed shape markers (`ngoId = DEMO_TENANT_SEED.ngoId` for campaigns/tenant, seed `recipientRef` values for claims)
