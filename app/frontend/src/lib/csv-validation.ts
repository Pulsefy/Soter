import Papa from 'papaparse';
import { fetchClient } from '@/lib/mock-api/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type WizardStep = 1 | 2 | 3 | 4;
export type ValidationSeverity = 'valid' | 'warning' | 'error';

export interface CsvPreviewRow {
  index: number;
  values: Record<string, string>;
}

export interface ValidationMessage {
  severity: Exclude<ValidationSeverity, 'valid'>;
  message: string;
  field?: string;
}

export interface ValidationRowResult {
  rowNumber: number;
  status: ValidationSeverity;
  values: Record<string, string>;
  messages: ValidationMessage[];
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
}

export interface ValidationResult {
  summary: ValidationSummary;
  rows: ValidationRowResult[];
}

export interface ParsedCsvData {
  headers: string[];
  rows: CsvPreviewRow[];
}

// ── Column schema ──────────────────────────────────────────────────────────────

export interface RequiredColumn {
  key: string;
  label: string;
  aliases: string[];
}

export const REQUIRED_COLUMNS: RequiredColumn[] = [
  { key: 'name', label: 'Name', aliases: ['fullname', 'recipientname'] },
  { key: 'wallet', label: 'Wallet Address', aliases: ['walletaddress', 'stellarwallet', 'publickey'] },
  { key: 'phone', label: 'Phone Number', aliases: ['phonenumber', 'mobile'] },
];

export interface ColumnValidationError {
  expectedKey: string;
  expectedLabel: string;
  expectedAliases: string[];
  actualHeader: string | null;
  suggestion: string | null;
  message: string;
}

export interface HeaderValidationResult {
  valid: boolean;
  errors: ColumnValidationError[];
}

// ── Progress types ────────────────────────────────────────────────────────────

export interface ParseProgress {
  phase: 'parsing';
  rowsParsed: number;
  percent: number;
}

export interface ValidateProgress {
  phase: 'validating';
  rowsValidated: number;
  totalRows: number;
  percent: number;
}

export type ImportProgress = ParseProgress | ValidateProgress;

// ── Capped display ────────────────────────────────────────────────────────────

export const MAX_DISPLAY_ERRORS = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function normalizeRecord(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key.trim(), cleanValue(value)]),
  );
}

function normalizeHeaderForComparison(header: string): string {
  return header.toLowerCase().replace(/[_\s-]+/g, '');
}

function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aBigrams = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    aBigrams.add(a.substring(i, i + 2));
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (aBigrams.has(b.substring(i, i + 2))) {
      intersection++;
    }
  }

  const union = aBigrams.size + b.length - 1 - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findClosestActualHeader(
  expectedNormalized: string,
  actualHeaders: string[],
): string | null {
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const actual of actualHeaders) {
    const normalized = normalizeHeaderForComparison(actual);
    if (normalized === expectedNormalized) {
      return actual;
    }

    const score = bigramSimilarity(expectedNormalized, normalized);
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = actual;
    }
  }

  return bestMatch;
}

// ── Column validation (header-level, before row processing) ───────────────────

export function validateHeaders(headers: string[]): HeaderValidationResult {
  const errors: ColumnValidationError[] = [];
  const normalizedHeaders = headers.map(h => normalizeHeaderForComparison(h));

  for (const required of REQUIRED_COLUMNS) {
    const allVariants = [required.key, ...required.aliases];

    const found = allVariants.some(variant => {
      const normalized = normalizeHeaderForComparison(variant);
      return normalizedHeaders.some(h => h === normalized);
    });

    if (found) continue;

    let closestMatch: string | null = null;

    for (const variant of allVariants) {
      const match = findClosestActualHeader(normalizeHeaderForComparison(variant), headers);
      if (match) {
        closestMatch = match;
        break;
      }
    }

    const allNames = allVariants.join(', ');
    const suggestion = closestMatch
      ? `Expected column '${required.key}', found '${closestMatch}' — did you mean this?`
      : `Expected column '${required.key}' (or one of: ${allNames}) was not found in the header row.`;

    errors.push({
      expectedKey: required.key,
      expectedLabel: required.label,
      expectedAliases: required.aliases,
      actualHeader: closestMatch,
      suggestion,
      message: suggestion,
    });
  }

  return { valid: errors.length === 0, errors };
}

// ── CSV file parsing (streaming / chunked) ────────────────────────────────────

export async function parseRecipientsCsv(
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParsedCsvData> {
  const text = await file.text();

  return new Promise((resolve, reject) => {
    const allRows: CsvPreviewRow[] = [];
    let headers: string[] = [];
    let rowCounter = 0;

    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h: string) => h.trim(),
      chunk: (results: Papa.ParseResult<Record<string, unknown>>) => {
        if (headers.length === 0 && results.meta.fields) {
          headers = results.meta.fields.map((h: string) => h.trim()).filter(Boolean);
        }

        const processedRows = (results.data ?? [])
          .map(normalizeRecord)
          .filter((row: Record<string, string>) => Object.values(row).some(Boolean))
          .map((values: Record<string, string>) => ({ index: ++rowCounter, values }));

        allRows.push(...processedRows);

        if (onProgress) {
          const totalChars = text.length;
          const percent = totalChars > 0
            ? Math.min(99, Math.round((results.meta.cursor / totalChars) * 100))
            : 0;
          onProgress({
            phase: 'parsing',
            rowsParsed: allRows.length,
            percent,
          });
        }
      },
      complete: () => {
        if (headers.length === 0 && allRows.length > 0) {
          headers = Object.keys(allRows[0].values);
        }

        if (headers.length === 0 && allRows.length === 0) {
          reject(new Error('The CSV file is empty or missing a header row.'));
          return;
        }

        if (onProgress) {
          onProgress({
            phase: 'parsing',
            rowsParsed: allRows.length,
            percent: 100,
          });
        }

        resolve({ headers, rows: allRows });
      },
      error: (error: Error) => reject(error),
    });
  });
}

// ── Row-level validation helpers ──────────────────────────────────────────────

function getCandidateValue(values: Record<string, string>, candidates: string[]): string {
  const normalizedEntries = Object.entries(values).map(([key, value]) => [key.toLowerCase(), value] as const);

  for (const candidate of candidates) {
    const match = normalizedEntries.find(([key]) => key === candidate || key.replace(/[_\s-]+/g, '') === candidate);
    if (match) {
      return match[1];
    }
  }

  return '';
}

function summarizeValidation(rows: ValidationRowResult[]): ValidationResult {
  const summary = rows.reduce<ValidationSummary>(
    (acc, row) => {
      acc.totalRows += 1;
      if (row.status === 'valid') acc.validRows += 1;
      if (row.status === 'warning') acc.warningRows += 1;
      if (row.status === 'error') acc.errorRows += 1;
      return acc;
    },
    { totalRows: 0, validRows: 0, warningRows: 0, errorRows: 0 },
  );

  return { summary, rows };
}

const VALIDATION_BATCH_SIZE = 500;

async function buildLocalValidationAsync(
  rows: CsvPreviewRow[],
  onProgress?: (progress: ValidateProgress) => void,
): Promise<ValidationResult> {
  const results: ValidationRowResult[] = [];

  for (let i = 0; i < rows.length; i += VALIDATION_BATCH_SIZE) {
    const batch = rows.slice(i, i + VALIDATION_BATCH_SIZE);

    for (const { index, values } of batch) {
      const messages: ValidationMessage[] = [];
      const fullName = getCandidateValue(values, ['fullname', 'name', 'recipientname']);
      const wallet = getCandidateValue(values, ['wallet', 'walletaddress', 'stellarwallet', 'publickey']);
      const phone = getCandidateValue(values, ['phone', 'phonenumber', 'mobile']);

      if (!fullName) {
        messages.push({ severity: 'error', field: 'fullName', message: 'Recipient name is required.' });
      }

      if (!wallet) {
        messages.push({ severity: 'error', field: 'wallet', message: 'Wallet address is required.' });
      } else if (wallet.length < 10) {
        messages.push({ severity: 'warning', field: 'wallet', message: 'Wallet address looks shorter than expected.' });
      }

      if (!phone) {
        messages.push({ severity: 'warning', field: 'phone', message: 'Phone number is missing.' });
      }

      const status: ValidationSeverity = messages.some(m => m.severity === 'error')
        ? 'error'
        : messages.some(m => m.severity === 'warning')
          ? 'warning'
          : 'valid';

      results.push({ rowNumber: index, status, values, messages });
    }

    if (onProgress) {
      onProgress({
        phase: 'validating',
        rowsValidated: results.length,
        totalRows: rows.length,
        percent: Math.round((results.length / rows.length) * 100),
      });
    }

    if (onProgress && i + VALIDATION_BATCH_SIZE < rows.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return summarizeValidation(results);
}

// ── Backend validation fallback ───────────────────────────────────────────────

interface RawValidationMessage {
  severity: 'warning' | 'error';
  field?: string;
  message: string;
}

function normalizeValidationMessage(message: unknown): RawValidationMessage | null {
  const entry = typeof message === 'object' && message ? message as Record<string, unknown> : {};
  const severity = entry.severity === 'error' || entry.severity === 'warning' ? entry.severity : 'warning';
  const text = cleanValue(entry.message ?? entry.text);

  if (!text) {
    return null;
  }

  return {
    severity,
    field: cleanValue(entry.field) || undefined,
    message: text,
  };
}

function normalizeBackendValidation(payload: unknown, fallbackRows: CsvPreviewRow[]): ValidationResult | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidateRows = (payload as { rows?: unknown; results?: unknown; data?: { rows?: unknown; results?: unknown } }).rows
    ?? (payload as { results?: unknown }).results
    ?? (payload as { data?: { rows?: unknown; results?: unknown } }).data?.rows
    ?? (payload as { data?: { rows?: unknown; results?: unknown } }).data?.results;

  if (!Array.isArray(candidateRows)) {
    return null;
  }

  const fallbackMap = new Map(fallbackRows.map(row => [row.index, row.values]));

  const rows = candidateRows.map<ValidationRowResult>((row, index) => {
    const item = typeof row === 'object' && row ? row as Record<string, unknown> : {};
    const rawMessages = Array.isArray(item.messages)
      ? item.messages
      : Array.isArray(item.issues)
        ? item.issues
        : [];
    const rowNumber = Number(item.rowNumber ?? item.row ?? index + 1);
    const messages = rawMessages
      .map(normalizeValidationMessage)
      .filter((message): message is RawValidationMessage => message !== null);

    const statusSource = cleanValue(item.status).toLowerCase();
    const status: ValidationSeverity = statusSource === 'error' || statusSource === 'warning' || statusSource === 'valid'
      ? statusSource
      : messages.some(message => message.severity === 'error')
        ? 'error'
        : messages.some(message => message.severity === 'warning')
          ? 'warning'
          : 'valid';

    const values =
      typeof item.values === 'object' && item.values
        ? normalizeRecord(item.values as Record<string, unknown>)
        : fallbackMap.get(rowNumber) ?? {};

    return {
      rowNumber,
      status,
      values,
      messages: messages.map(message => ({
        severity: message.severity,
        field: message.field,
        message: message.message,
      })),
    };
  });

  return summarizeValidation(rows);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function validateRecipientsImport(
  campaignId: string,
  file: File,
  rows: CsvPreviewRow[],
  onProgress?: (progress: ValidateProgress) => void,
): Promise<ValidationResult> {
  const payload = new FormData();
  payload.append('file', file);
  payload.append('campaignId', campaignId);

  try {
    const response = await fetchClient(`${API_URL}/recipients/import/validate`, {
      method: 'POST',
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Validation request failed with status ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    return normalizeBackendValidation(body, rows) ?? buildLocalValidationAsync(rows, onProgress);
  } catch {
    return buildLocalValidationAsync(rows, onProgress);
  }
}

export async function confirmRecipientsImport(campaignId: string, file: File): Promise<string> {
  const payload = new FormData();
  payload.append('file', file);
  payload.append('campaignId', campaignId);

  const response = await fetchClient(`${API_URL}/recipients/import/confirm`, {
    method: 'POST',
    body: payload,
  });

  let body: { message?: string; success?: boolean } | null = null;
  try {
    body = (await response.json()) as { message?: string; success?: boolean };
  } catch {
    body = null;
  }

  if (!response.ok || body?.success === false) {
    throw new Error(body?.message ?? 'Unable to complete recipient import.');
  }

  return body?.message ?? 'Recipients imported successfully.';
}

export function buildValidationReport(result: ValidationResult): Blob {
  const csv = Papa.unparse(
    result.rows.map(row => ({
      rowNumber: row.rowNumber,
      status: row.status,
      messages: row.messages.map(message => message.message).join(' | '),
      fields: row.messages.map(message => message.field ?? '').filter(Boolean).join(' | '),
    })),
  );

  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

// ── Error capping ─────────────────────────────────────────────────────────────

export function capValidationErrors(
  result: ValidationResult,
  maxDisplay: number = MAX_DISPLAY_ERRORS,
): { display: ValidationResult; remainingErrors: number; remainingWarnings: number } {
  const errorRows = result.rows.filter(r => r.status === 'error');
  const warningRows = result.rows.filter(r => r.status === 'warning');
  const validRows = result.rows.filter(r => r.status === 'valid');

  const cappedErrorRows = errorRows.slice(0, maxDisplay);
  const remainingErrors = errorRows.length - cappedErrorRows.length;

  const warningBudget = Math.max(0, maxDisplay - cappedErrorRows.length);
  const cappedWarningRows = warningRows.slice(0, warningBudget);
  const remainingWarnings = warningRows.length - cappedWarningRows.length;

  const displayRows = [...cappedErrorRows, ...cappedWarningRows, ...validRows];
  const display = summarizeValidation(displayRows);

  return { display, remainingErrors, remainingWarnings };
}
