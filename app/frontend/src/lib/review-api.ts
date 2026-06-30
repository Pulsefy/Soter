import type {
  ReviewQueueResponse,
  ReviewCaseDetail,
  ReviewQueueFilters,
} from '@/types/review-case';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ReviewApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewApiError';
  }
}

function buildQueryString(filters: ReviewQueueFilters & { page?: number; limit?: number }): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.riskLevel) params.set('riskLevel', filters.riskLevel);
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  return params.toString();
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  if (response.status >= 400 && response.status < 500) {
    let message = 'Request failed. Please check your input and try again.';
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === 'string' && body.message.trim().length > 0) {
        message = body.message;
      }
    } catch {
      // ignore
    }
    throw new ReviewApiError(message);
  }

  throw new ReviewApiError('The service is temporarily unavailable. Please try again later.');
}

export async function fetchReviewQueue(
  filters: ReviewQueueFilters & { page?: number; limit?: number } = {},
): Promise<ReviewQueueResponse> {
  const qs = buildQueryString(filters);
  const response = await fetch(`${API_URL}/api/v1/verification/review-queue?${qs}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<ReviewQueueResponse>(response);
}

export async function fetchReviewCase(id: string): Promise<ReviewCaseDetail> {
  const response = await fetch(`${API_URL}/api/v1/verification/review-queue/${id}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<ReviewCaseDetail>(response);
}

export async function approveReviewCase(id: string, notes?: string): Promise<ReviewCaseDetail> {
  const response = await fetch(`${API_URL}/api/v1/verification/review-queue/${id}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notes }),
  });
  return handleResponse<ReviewCaseDetail>(response);
}

export async function rejectReviewCase(id: string, notes?: string): Promise<ReviewCaseDetail> {
  const response = await fetch(`${API_URL}/api/v1/verification/review-queue/${id}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notes }),
  });
  return handleResponse<ReviewCaseDetail>(response);
}
