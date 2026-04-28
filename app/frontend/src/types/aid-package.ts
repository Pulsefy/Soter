export type AidPackageStatus = 'Active' | 'Claimed' | 'Expired';
export type TokenType = 'USDC' | 'XLM' | 'EURC';
export type FilterScope = 'dashboard' | 'campaigns';

export interface AidPackage {
  id: string;
  title: string;
  region: string;
  amount: string;
  recipients: number;
  status: AidPackageStatus;
  token: TokenType;
}

export interface AidPackageFilters {
  search?: string;
  status?: AidPackageStatus | '';
  token?: TokenType | '';
}

/** A named, saved filter combination for a specific admin list view */
export interface FilterPreset {
  /** Unique ID (timestamp-based) */
  id: string;
  /** User-defined label shown on the chip */
  name: string;
  /** Which list this preset applies to */
  scope: FilterScope;
  /** The filter values captured at save time */
  filters: AidPackageFilters;
  createdAt: number;
}
