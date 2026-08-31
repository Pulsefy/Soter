// src/lib/api-client.ts
import createClient from 'openapi-fetch';
import type { paths } from '@/types/generated/api'; // Generated from backend OpenAPI spec

export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
});