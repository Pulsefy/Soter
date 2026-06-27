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
  page?: number;
  limit?: number;
}

export interface RegistrySearchResult {
  id: string;
  registryId: string;
  name: string;
  entityType: string;
  confidenceScore: number;
  matchMethod: string;
}
