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
    } else if (typeof value === 'string') {
      let redactedValue = value;
      // Redact email
      redactedValue = redactedValue.replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
        '[REDACTED_EMAIL]',
      );
      // Redact phone number
      redactedValue = redactedValue.replace(
        /\+?\d{1,3}?[-.\s]?\(?\d{1,4}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
        '[REDACTED_PHONE]',
      );
      // Redact IP
      redactedValue = redactedValue.replace(
        /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
        '[REDACTED_IP]',
      );
      result[key] = redactedValue;
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
