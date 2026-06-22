import { CORRELATION_ID_HEADER } from '../common/utils/correlation-id.util';

export function buildPropagationHeaders(
  correlationId: string,
): Record<string, string> {
  return { [CORRELATION_ID_HEADER]: correlationId };
}

export function mergeCorrelationHeaders(
  correlationId: string,
  existing: Record<string, string> = {},
): Record<string, string> {
  return { ...existing, ...buildPropagationHeaders(correlationId) };
}
