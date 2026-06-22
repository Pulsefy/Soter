import { ErrorCategory } from '@/types/error';

export function categorizeError(error: unknown): ErrorCategory {
  if (!error) return 'unknown';

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Wallet errors
  if (
    message.includes('freighter') ||
    message.includes('wallet') ||
    message.includes('user declined') ||
    message.includes('signature') ||
    message.includes('permission')
  ) {
    return 'wallet';
  }

  // Network errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to fetch') ||
    message.includes('connectivity') ||
    message.includes('dns') ||
    message.includes('abort')
  ) {
    return 'network';
  }

  // Server errors
  if (
    message.includes('server') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('unavailable') ||
    message.includes('bad gateway')
  ) {
    return 'server';
  }

  return 'unknown';
}
