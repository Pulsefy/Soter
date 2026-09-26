import { EntityLinkReviewStatus } from '@prisma/client';

export interface CreateEntityLinkDto {
  sourceType: 'campaign' | 'claim' | 'verification';
  sourceId: string;
  extractedName: string;
  extractedType?: string;
  entityType: 'organization' | 'location' | 'asset' | 'project';
  registryId?: string; // Optional: if linking to existing registry record
  confidenceScore: number;
  matchMethod?: string;
  metadata?: Record<string, unknown>;
}

export interface LinkEntityResult {
  id: string;
  sourceType: string;
  sourceId: string;
  extractedName: string;
  extractedType: string | null;
  entityType: string;
  organizationId: string | null;
  locationId: string | null;
  assetId: string | null;
  projectId: string | null;
  confidenceScore: number;
  matchMethod: string | null;
  reviewStatus: EntityLinkReviewStatus;
  queuedAt: Date | null;
  isActive: boolean;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityLinkQueryDto {
  sourceType?: 'campaign' | 'claim' | 'verification';
  sourceId?: string;
  entityType?: 'organization' | 'location' | 'asset' | 'project';
  minConfidence?: number;
  isActive?: boolean;
  reviewStatus?: EntityLinkReviewStatus;
  page?: number;
  limit?: number;
}

/**
 * Query params for listing the low-confidence review queue
 * (`GET /entity-linking/review-queue`). Always scoped to
 * `reviewStatus: pending_review` server-side.
 */
export interface EntityLinkReviewQueueQueryDto {
  entityType?: 'organization' | 'location' | 'asset' | 'project';
  sourceType?: 'campaign' | 'claim' | 'verification';
  page?: number;
  limit?: number;
}

export type EntityLinkReviewAction = 'accept' | 'reject' | 'remap';

/**
 * Body for `PATCH /entity-linking/review/:linkId` — a reviewer's decision
 * on a queued (or previously decided) link.
 */
export interface ReviewEntityLinkDto {
  action: EntityLinkReviewAction;
  reviewNotes?: string;
  /** Required when action is 'remap': the canonical registry record to
   * point this link at instead. registryId is matched the same way
   * CreateEntityLinkDto.registryId is (RegistryOrganization.registryId, etc). */
  remapEntityType?: 'organization' | 'location' | 'asset' | 'project';
  remapRegistryId?: string;
}

export interface RegistrySearchResult {
  id: string;
  registryId: string;
  name: string;
  entityType: string;
  confidenceScore: number;
  matchMethod: string;
}
