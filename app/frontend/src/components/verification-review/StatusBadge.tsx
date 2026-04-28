import React from 'react';
import type {
  VerificationStatus,
  RiskLevel,
} from '@/types/verification-review';

const STATUS_CONFIG: Record<
  VerificationStatus,
  { label: string; className: string }
> = {
  pending_review: {
    label: 'Pending Review',
    className:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  approved: {
    label: 'Approved',
    className:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
  needs_resubmission: {
    label: 'Needs Resubmission',
    className:
      'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  },
};

const RISK_CONFIG: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: 'Low Risk',
    className:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  medium: {
    label: 'Medium Risk',
    className:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  high: {
    label: 'High Risk',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
};

export function StatusBadge({ status }: { status: VerificationStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const cfg = RISK_CONFIG[level];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}
