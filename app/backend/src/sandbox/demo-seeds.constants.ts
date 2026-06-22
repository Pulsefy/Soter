/**
 * @file demo-seeds.constants.ts
 *
 * ⚠️  SANDBOX USE ONLY ⚠️
 *
 * The constants in this file are exclusively for local development and preview
 * environments. They MUST NOT be imported in any production code path.
 * Importing these constants outside of the `sandbox` module or test files is
 * a code-review violation.
 */

import { CampaignStatus, ClaimStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Seed shape interfaces
// ---------------------------------------------------------------------------

/** Shape of the demo tenant (NGO) seed. */
export interface DemoTenantSeed {
  /** Fixed deterministic identifier for the demo NGO. */
  ngoId: string;
  /** Human-readable display name for the demo organization. */
  name: string;
  /** Short description shown in UI previews. */
  description: string;
  /** Geographic region the demo org operates in. */
  region: string;
}

/** Shape of a single demo campaign seed entry. */
export interface DemoCampaignSeed {
  /** Campaign display name — used as the idempotency key alongside `ngoId`. */
  name: string;
  /** Lifecycle status of the campaign at seed time. */
  status: CampaignStatus;
  /** Total budget allocated to the campaign (in USD). */
  budget: number;
  /**
   * Arbitrary metadata attached to the campaign.
   * Must include at minimum `region` and `partner` keys.
   * Add extra keys freely — they are stored as JSON.
   */
  metadata: { region: string; partner: string; [key: string]: unknown };
}

/** Shape of a single demo claim seed entry. */
export interface DemoClaimSeed {
  /**
   * References a campaign by name from `DEMO_CAMPAIGN_SEEDS`.
   * The seed service resolves this to a `campaignId` at runtime.
   * Use a variable reference (e.g. `DEMO_CAMPAIGN_SEEDS[0].name`) rather than
   * a hardcoded string so the relationship stays refactor-safe.
   */
  campaignName: string;
  /** Unique recipient identifier — used as the idempotency key alongside `campaignId`. */
  recipientRef: string;
  /** Claim amount in USD. */
  amount: number;
  /** Lifecycle status of the claim at seed time. */
  status: ClaimStatus;
  /**
   * Optional reference to an evidence document (e.g. an S3 key or IPFS CID).
   * At least one entry in `DEMO_CLAIM_SEEDS` must supply this field.
   */
  evidenceRef?: string;
}

// ---------------------------------------------------------------------------
// DEMO_TENANT_SEED
// ---------------------------------------------------------------------------

/**
 * Seed shape for the demo NGO tenant.
 *
 * Purpose: Provides a fixed, deterministic tenant context for all demo
 * campaigns and claims. The `ngoId` value is the idempotency key — the seed
 * service will never create a second record with this identifier.
 *
 * Fields:
 * - `ngoId`       — well-known fixed string; do not change without updating
 *                   all downstream seed shapes and tests.
 * - `name`        — display name shown in admin UIs.
 * - `description` — short blurb for preview environments.
 * - `region`      — primary operating region for the demo org.
 *
 * Extending: Add new fields to the `DemoTenantSeed` interface first, then
 * update this constant and the `seedTenant()` method in `SeedService`.
 */
export const DEMO_TENANT_SEED: DemoTenantSeed = {
  ngoId: 'demo-ngo-seed-001',
  name: 'Demo Relief Organization',
  description:
    'A synthetic NGO tenant used exclusively for local development and preview environments.',
  region: 'East Africa',
};

// ---------------------------------------------------------------------------
// DEMO_CAMPAIGN_SEEDS
// ---------------------------------------------------------------------------

/**
 * Seed shapes for demo campaigns.
 *
 * Purpose: Provides at least one campaign in each major lifecycle status so
 * that contributors can exercise campaign-related UI and API flows without
 * manually crafting data.
 *
 * Fields (per entry):
 * - `name`     — unique display name; used as idempotency key with `ngoId`.
 * - `status`   — one of the `CampaignStatus` enum values.
 * - `budget`   — total budget in USD.
 * - `metadata` — JSON blob; must include `region` and `partner` at minimum.
 *
 * Extending: Append a new `DemoCampaignSeed` object to this array. The seed
 * service will pick it up automatically on the next run. Ensure the `name` is
 * unique within the demo tenant to preserve idempotency.
 */
export const DEMO_CAMPAIGN_SEEDS: DemoCampaignSeed[] = [
  {
    // Draft campaign — not yet published; useful for testing creation flows.
    name: 'Demo Campaign — Draft',
    status: CampaignStatus.draft,
    budget: 50_000,
    metadata: {
      region: 'East Africa',
      partner: 'UNHCR',
    },
  },
  {
    // Active campaign — currently accepting claims; the primary test target.
    name: 'Demo Campaign — Active',
    status: CampaignStatus.active,
    budget: 120_000,
    metadata: {
      region: 'West Africa',
      partner: 'WFP',
    },
  },
  {
    // Paused campaign — temporarily suspended; useful for testing pause/resume flows.
    name: 'Demo Campaign — Paused',
    status: CampaignStatus.paused,
    budget: 75_000,
    metadata: {
      region: 'South Asia',
      partner: 'ICRC',
    },
  },
  {
    // Completed campaign — all funds disbursed; useful for read-only history views.
    name: 'Demo Campaign — Completed',
    status: CampaignStatus.completed,
    budget: 200_000,
    metadata: {
      region: 'Middle East',
      partner: 'Oxfam',
    },
  },
];

// ---------------------------------------------------------------------------
// DEMO_CLAIM_SEEDS
// ---------------------------------------------------------------------------

/**
 * Seed shapes for demo claims.
 *
 * Purpose: Provides at least one claim in each relevant lifecycle status so
 * that contributors can test claim workflows end-to-end without manually
 * crafting data.
 *
 * Fields (per entry):
 * - `campaignName` — references a campaign by name from `DEMO_CAMPAIGN_SEEDS`.
 *                    The seed service resolves this to a `campaignId` at runtime.
 *                    Always use `DEMO_CAMPAIGN_SEEDS[n].name` — never a hardcoded
 *                    string — so the reference stays refactor-safe.
 * - `recipientRef` — unique recipient identifier; idempotency key with `campaignId`.
 * - `amount`       — claim amount in USD.
 * - `status`       — one of the `ClaimStatus` enum values.
 * - `evidenceRef`  — optional evidence document reference (at least one entry
 *                    must supply this field).
 *
 * Extending: Append a new `DemoClaimSeed` object to this array. Ensure
 * `campaignName` references an existing entry in `DEMO_CAMPAIGN_SEEDS` and
 * that `recipientRef` is unique within the target campaign.
 */
export const DEMO_CLAIM_SEEDS: DemoClaimSeed[] = [
  {
    // Requested claim — submitted but not yet reviewed.
    campaignName: DEMO_CAMPAIGN_SEEDS[1].name, // 'Demo Campaign — Active'
    recipientRef: 'demo-recipient-001',
    amount: 500,
    status: ClaimStatus.requested,
  },
  {
    // Verified claim — identity/evidence confirmed, awaiting approval.
    campaignName: DEMO_CAMPAIGN_SEEDS[1].name, // 'Demo Campaign — Active'
    recipientRef: 'demo-recipient-002',
    amount: 750,
    status: ClaimStatus.verified,
    evidenceRef: 'evidence/demo-recipient-002/id-verification.pdf',
  },
  {
    // Approved claim — approved for disbursement.
    campaignName: DEMO_CAMPAIGN_SEEDS[3].name, // 'Demo Campaign — Completed'
    recipientRef: 'demo-recipient-003',
    amount: 1_000,
    status: ClaimStatus.approved,
    evidenceRef: 'evidence/demo-recipient-003/approval-doc.pdf',
  },
];
