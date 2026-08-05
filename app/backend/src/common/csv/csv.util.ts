/**
 * Escapes a single value for inclusion in a CSV field, per RFC 4180:
 * wraps in double quotes and doubles any embedded quote characters.
 */
export function escapeCsvField(
  value: string | number | null | undefined,
): string {
  const str = String(value ?? '').replace(/"/g, '""');
  return `"${str}"`;
}

/** Joins already-escaped fields into a single CSV row terminated by CRLF. */
export function toCsvRow(fields: string[]): string {
  return fields.join(',') + '\r\n';
}
