const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'creditcard',
  'ssn',
]);

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

export function redactLogData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitive(key)) {
      result[key] = '[REDACTED]';
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      result[key] = redactLogData(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
