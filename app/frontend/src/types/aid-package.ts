export type AidPackageStatus = 'Active' | 'Claimed' | 'Expired';
export type TokenType = 'USDC' | 'XLM' | 'EURC';

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
