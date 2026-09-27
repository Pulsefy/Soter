import { extractApiError } from './error-utils';

export interface GlobalStats {
  totalAidDisbursed: number;
  totalRecipients: number;
  activeCampaigns: number;
  byToken: { label: string; totalAmount: number; count: number }[];
  byRegion: { label: string; totalAmount: number; count: number }[];
  timeSeries: { date: string; totalAmount: number; count: number }[];
  computedAt: string;
}

export async function fetchGlobalStats(): Promise<GlobalStats> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    throw new Error(
      'Dashboard summary requires NEXT_PUBLIC_API_URL. Configure the backend URL to load live metrics.',
    );
  }

  const response = await fetch(`${apiUrl}/api/v1/analytics/global-stats`);
  if (!response.ok) {
    throw await extractApiError(response);
  }

  const stats: unknown = await response.json();
  if (
    !stats ||
    typeof stats !== 'object' ||
    typeof (stats as GlobalStats).totalAidDisbursed !== 'number' ||
    typeof (stats as GlobalStats).totalRecipients !== 'number' ||
    typeof (stats as GlobalStats).activeCampaigns !== 'number'
  ) {
    throw new Error(
      'The analytics service returned an invalid dashboard summary.',
    );
  }

  return stats as GlobalStats;
}
