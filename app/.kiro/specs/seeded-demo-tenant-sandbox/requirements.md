# Requirements Document

## Introduction

This feature provides a fast, repeatable way for contributors and reviewers to spin up realistic demo data
for local development and preview environments. It introduces protected sandbox-only HTTP endpoints and
a CLI-friendly seed script that generate a demo organization (NGO tenant), campaigns in various states,
and claims with associated evidence references. The feature is disabled by default and must be explicitly
enabled via an environment variable. All seed shapes are documented in code comments and DTO examples so
contributors can safely extend them.

## Glossary

- **Sandbox_Controller**: The NestJS controller that exposes the `/admin/sandbox/seed` and related endpoints.
- **Seed_Service**: The NestJS service responsible for creating demo organizations, campaigns, and claims in the database.
- **Demo_Tenant**: A synthetic NGO organization record created solely for demonstration and local development purposes.
- **Seed_Shape**: A typed DTO or constant that defines the exact field values used when generating a demo entity.
- **Sandbox_Guard**: A NestJS guard that rejects all requests when the `SANDBOX_ENABLED` environment variable is not set to `"true"`.
- **Admin_Role**: The `AppRole.admin` role as defined in the existing `AppRole` enum; required to call sandbox endpoints.
- **SANDBOX_ENABLED**: An environment variable that must equal `"true"` for sandbox endpoints to be active.
- **Idempotent_Seed**: A seed operation that produces the same result when run multiple times, avoiding duplicate records.

---

## Requirements

### Requirement 1: Sandbox Environment Guard

**User Story:** As a platform operator, I want sandbox endpoints to be completely inaccessible in production,
so that demo data cannot be accidentally created in live environments.

#### Acceptance Criteria

1. THE `Sandbox_Guard` SHALL read the `SANDBOX_ENABLED` environment variable on every incoming request to a sandbox endpoint.
2. WHEN `SANDBOX_ENABLED` is not equal to `"true"`, THE `Sandbox_Guard` SHALL reject the request with HTTP 403 Forbidden.
3. WHEN `SANDBOX_ENABLED` equals `"true"`, THE `Sandbox_Guard` SHALL allow the request to proceed to the next guard in the chain.
4. THE `Sandbox_Guard` SHALL be applied exclusively to the `Sandbox_Controller` and SHALL NOT affect any other controller.
5. IF the `SANDBOX_ENABLED` environment variable is absent, THEN THE `Sandbox_Guard` SHALL treat it as disabled and return HTTP 403 Forbidden.

---

### Requirement 2: Admin Role Enforcement on Sandbox Endpoints

**User Story:** As a security-conscious contributor, I want sandbox endpoints to require admin credentials,
so that only authorized callers can generate demo data even in sandbox environments.

#### Acceptance Criteria

1. THE `Sandbox_Controller` SHALL require the `Admin_Role` on all of its endpoints using the existing `@Roles(AppRole.admin)` decorator.
2. WHEN a request carries a non-admin API key, THE `Sandbox_Controller` SHALL return HTTP 403 Forbidden.
3. WHEN a request carries a valid admin API key and `SANDBOX_ENABLED` equals `"true"`, THE `Sandbox_Controller` SHALL process the request.

---

### Requirement 3: Seed Demo Tenant (Organization)

**User Story:** As a contributor, I want a seed endpoint to create a realistic demo NGO organization,
so that I have a tenant context for campaigns and claims during local development.

#### Acceptance Criteria

1. WHEN `POST /api/v1/admin/sandbox/seed/tenant` is called, THE `Seed_Service` SHALL create a `Demo_Tenant` record using the predefined `DEMO_TENANT_SEED` shape.
2. THE `DEMO_TENANT_SEED` shape SHALL include at minimum: `ngoId` (a fixed deterministic string), `name`, `description`, and `region` fields documented in code comments.
3. WHEN the `Demo_Tenant` already exists (matched by the fixed `ngoId`), THE `Seed_Service` SHALL return the existing record without creating a duplicate (`Idempotent_Seed`).
4. WHEN the `Demo_Tenant` is created successfully, THE `Seed_Service` SHALL return a response containing the tenant `ngoId` and a `created: true` flag.
5. WHEN the `Demo_Tenant` already existed, THE `Seed_Service` SHALL return a response containing the tenant `ngoId` and a `created: false` flag.

---

### Requirement 4: Seed Demo Campaigns

**User Story:** As a contributor, I want a seed endpoint to create demo campaigns in multiple statuses,
so that I can test campaign-related UI and API flows without manually crafting data.

#### Acceptance Criteria

1. WHEN `POST /api/v1/admin/sandbox/seed/campaigns` is called, THE `Seed_Service` SHALL create campaigns using the predefined `DEMO_CAMPAIGN_SEEDS` array.
2. THE `DEMO_CAMPAIGN_SEEDS` array SHALL contain at least four entries covering the `draft`, `active`, `paused`, and `completed` `CampaignStatus` values, each documented with inline code comments.
3. WHEN a campaign with the same `name` and `ngoId` already exists, THE `Seed_Service` SHALL skip creation for that entry and include it in the `skipped` count of the response (`Idempotent_Seed`).
4. THE `Seed_Service` SHALL return a response containing `created` count, `skipped` count, and an array of campaign IDs for all seeded campaigns.
5. THE `DEMO_CAMPAIGN_SEEDS` array SHALL include a `metadata` field on each entry with at least `region` and `partner` keys to demonstrate the metadata shape.

---

### Requirement 5: Seed Demo Claims

**User Story:** As a contributor, I want a seed endpoint to create demo claims against the seeded campaigns,
so that I can test claim workflows end-to-end in a local environment.

#### Acceptance Criteria

1. WHEN `POST /api/v1/admin/sandbox/seed/claims` is called, THE `Seed_Service` SHALL create claims using the predefined `DEMO_CLAIM_SEEDS` array against the seeded campaigns.
2. THE `DEMO_CLAIM_SEEDS` array SHALL contain at least three entries covering the `requested`, `verified`, and `approved` `ClaimStatus` values, each documented with inline code comments.
3. WHEN the target campaign does not exist in the database, THE `Seed_Service` SHALL return HTTP 422 Unprocessable Entity with a descriptive error message indicating the missing campaign.
4. WHEN a claim with the same `recipientRef` and `campaignId` already exists, THE `Seed_Service` SHALL skip creation for that entry and include it in the `skipped` count (`Idempotent_Seed`).
5. THE `Seed_Service` SHALL return a response containing `created` count, `skipped` count, and an array of claim IDs for all seeded claims.
6. THE `DEMO_CLAIM_SEEDS` array SHALL include an `evidenceRef` field on at least one entry to demonstrate the evidence reference shape.

---

### Requirement 6: Full Seed Orchestration Endpoint

**User Story:** As a contributor, I want a single endpoint that seeds all demo data in the correct order,
so that I can bootstrap a complete local environment with one HTTP call.

#### Acceptance Criteria

1. WHEN `POST /api/v1/admin/sandbox/seed` is called, THE `Seed_Service` SHALL execute tenant seeding, then campaign seeding, then claim seeding in that order.
2. WHEN any step in the seed sequence fails, THE `Seed_Service` SHALL return HTTP 500 with a message identifying which step failed and the underlying error.
3. THE `Seed_Service` SHALL return a combined response containing the results of all three seed steps under `tenant`, `campaigns`, and `claims` keys.
4. THE full seed endpoint SHALL be idempotent: calling it multiple times SHALL produce the same final database state.

---

### Requirement 7: Seed Reset Endpoint

**User Story:** As a contributor, I want an endpoint to delete all seeded demo data,
so that I can start from a clean state without manually clearing the database.

#### Acceptance Criteria

1. WHEN `DELETE /api/v1/admin/sandbox/seed` is called, THE `Seed_Service` SHALL delete all claims, campaigns, and tenant records that were created by the seed shapes (identified by their fixed `ngoId` or `recipientRef` markers).
2. THE `Seed_Service` SHALL return a response containing the count of deleted claims, campaigns, and tenants.
3. WHEN no seeded records exist, THE `Seed_Service` SHALL return counts of zero without error.
4. THE reset operation SHALL NOT delete any records that were not created by the seed shapes.

---

### Requirement 8: Seed Shape Documentation

**User Story:** As a contributor, I want all seed shapes documented in code,
so that I can safely extend or modify demo data without breaking existing flows.

#### Acceptance Criteria

1. THE `Seed_Service` SHALL define all seed shapes as exported typed constants (`DEMO_TENANT_SEED`, `DEMO_CAMPAIGN_SEEDS`, `DEMO_CLAIM_SEEDS`) in a dedicated `demo-seeds.constants.ts` file.
2. EACH seed constant SHALL include a JSDoc comment block describing its purpose, the fields it covers, and instructions for extending it.
3. THE `demo-seeds.constants.ts` file SHALL include a top-level file comment explaining that these shapes are for sandbox use only and must not be imported in production code paths.
4. WHERE a seed shape references another entity (e.g., a claim referencing a campaign), THE constant SHALL use a named reference variable rather than a hardcoded string literal, so the relationship is explicit and refactor-safe.
