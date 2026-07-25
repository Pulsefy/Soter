/**
 * Types for the Activity Center component.
 * Tracks pending, succeeded, and failed on-chain actions and jobs.
 */

export type ActivityStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export type ActivityType = 'transaction' | 'job' | 'verification' | 'notification' | 'audit' | 'review';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  title: string;
  description: string;
  timestamp: Date;
  currentStep?: string;
  retryAction?: () => Promise<unknown>;
  explorerUrl?: string;
  transactionHash?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  read?: boolean;
  correlationId?: string;
  linkHref?: string;
  linkLabel?: string;
}

export interface ActivityStore {
  activities: ActivityItem[];
  addActivity: (activity: Omit<ActivityItem, 'id' | 'timestamp'>) => string;
  updateActivity: (id: string, updates: Partial<ActivityItem>) => void;
  removeActivity: (id: string) => void;
  clearCompleted: () => void;
}
