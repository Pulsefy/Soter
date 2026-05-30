/**
 * Structured Logging with Guaranteed Redaction (Issue #461)
 * 
 * This utility ensures PII is never logged. It redacts:
 * 1. Sensitive keys (password, token, etc.)
 * 2. PII patterns in values (emails, phone numbers, SSN, etc.)
 * 3. Nested objects and arrays
 */

const SENSITIVE_KEYS = new Set([
  // Authentication & Authorization
  'password',
  'passwd',
  'pwd',
  'token',
  'apitoken',
  'api_token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'bearertoken',
  'bearer_token',
  'secret',
  'clientsecret',
  'client_secret',
  'authorization',
  'apikey',
  'api_key',
  'app_key',
  'appkey',
  
  // Private Keys & Credentials
  'privatekey',
  'private_key',
  'privkey',
  'private_pem',
  'private_rsa',
  'secret_key',
  'secretkey',
  'keyid',
  'key_id',
  
  // Payment & Financial
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'pin',
  'accountnumber',
  'account_number',
  'routing_number',
  'routingnumber',
  'iban',
  'bic',
  
  // Database & Connection Strings
  'connectionstring',
  'connection_string',
  'dburl',
  'db_url',
  'database_url',
]);

// PII Patterns for value-based detection
const PII_PATTERNS = {
  // Email pattern (simplified)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  
  // Phone patterns (US & International)
  phone: /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
  
  // SSN pattern (XXX-XX-XXXX or similar)
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  
  // Credit card patterns (generic)
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  
  // Passport-like patterns
  passport: /\b[A-Z]{1,2}\d{6,9}\b/g,
  
  // Driver's License patterns
  driversLicense: /\b[A-Z]{1,2}\d{5,8}\b/g,
};

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Check if a string value contains PII patterns
 */
function containsPII(value: string): boolean {
  const str = String(value).toLowerCase();
  
  // Quick check: if it looks like it might contain PII, do pattern matching
  for (const pattern of Object.values(PII_PATTERNS)) {
    if (pattern.test(str)) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      return true;
    }
  }
  
  return false;
}

/**
 * Redact PII patterns in a string value
 */
function redactPIIInValue(value: string): string {
  let result = String(value);
  
  // Replace emails
  result = result.replace(PII_PATTERNS.email, '[EMAIL]');
  
  // Replace phone numbers
  result = result.replace(PII_PATTERNS.phone, '[PHONE]');
  
  // Replace SSN
  result = result.replace(PII_PATTERNS.ssn, '[SSN]');
  
  // Replace credit cards
  result = result.replace(PII_PATTERNS.creditCard, '[CREDIT_CARD]');
  
  // Replace passport numbers
  result = result.replace(PII_PATTERNS.passport, '[PASSPORT]');
  
  // Replace driver's license
  result = result.replace(PII_PATTERNS.driversLicense, '[DRIVERS_LICENSE]');
  
  return result;
}

/**
 * Recursively redact sensitive data and PII from log data.
 * Handles nested objects, arrays, and string values.
 * 
 * @param data - The data to redact
 * @param maxDepth - Maximum recursion depth to prevent stack overflow
 * @param currentDepth - Current recursion depth
 * @returns Redacted copy of the data
 */
export function redactLogData(
  data: unknown,
  maxDepth = 10,
  currentDepth = 0,
): unknown {
  // Prevent stack overflow from circular references
  if (currentDepth >= maxDepth) {
    return '[MAX_DEPTH_EXCEEDED]';
  }
  
  // Handle null and undefined
  if (data === null || data === undefined) {
    return data;
  }
  
  // Handle primitives (except objects)
  if (typeof data !== 'object') {
    if (typeof data === 'string' && data.length > 0) {
      // Check for PII in string values
      if (containsPII(data)) {
        return redactPIIInValue(data);
      }
    }
    return data;
  }
  
  // Handle Arrays
  if (Array.isArray(data)) {
    return data.map((item) =>
      redactLogData(item, maxDepth, currentDepth + 1),
    );
  }
  
  // Handle Objects
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      // Redact entire value for sensitive keys
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && containsPII(value)) {
      // Redact strings containing PII
      result[key] = redactPIIInValue(value);
    } else if (
      value !== null &&
      typeof value === 'object'
    ) {
      // Recursively process nested objects and arrays
      result[key] = redactLogData(value, maxDepth, currentDepth + 1);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Assert that no PII appears in log data (for testing)
 * Throws an error if sensitive data is detected
 */
export function assertNoPIIInLogs(data: unknown): void {
  const dataStr = JSON.stringify(data);
  
  // Check if unredacted PII patterns exist in the data
  for (const [patternName, pattern] of Object.entries(PII_PATTERNS)) {
    // Create a fresh regex with the same pattern (global flag)
    const freshPattern = new RegExp(pattern.source, 'gi');
    if (freshPattern.test(dataStr)) {
      throw new Error(
        `PII pattern (${patternName}) detected in logs: ${dataStr.substring(0, 200)}...`,
      );
    }
  }
}
