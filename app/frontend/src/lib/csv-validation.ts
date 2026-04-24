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

interface RawValidationMessage {
  severity: 'warning' | 'error';
  field?: string;
  message: string;
}

function cleanValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function normalizeRecord(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key.trim(), cleanValue(value)]),
  );
}

export async function parseRecipientsCsv(file: File): Promise<ParsedCsvData> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: header => header.trim(),
      complete: results => {
        if (results.errors.length > 0) {
          reject(new Error(results.errors[0]?.message ?? 'Unable to parse CSV file.'));
          return;
        }

        const rows = (results.data ?? [])
          .map(normalizeRecord)
          .filter(row => Object.values(row).some(Boolean))
          .map((values, index) => ({ index: index + 1, values }));

        const headers =
          results.meta.fields?.map(header => header.trim()).filter(Boolean) ??
          Object.keys(rows[0]?.values ?? {});

        if (headers.length === 0) {
          reject(new Error('The CSV file is empty or missing a header row.'));
          return;
        }

        resolve({ headers, rows });
      },
      error: error => reject(error),
    });
  });
}

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

function buildLocalValidation(rows: CsvPreviewRow[]): ValidationResult {
  const results = rows.map<ValidationRowResult>(({ index, values }) => {
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

    const status: ValidationSeverity = messages.some(message => message.severity === 'error')
      ? 'error'
      : messages.some(message => message.severity === 'warning')
        ? 'warning'
        : 'valid';

    return {
      rowNumber: index,
      status,
      values,
      messages,
    };
  });

  return summarizeValidation(results);
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

export async function validateRecipientsImport(
  campaignId: string,
  file: File,
  rows: CsvPreviewRow[],
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
    return normalizeBackendValidation(body, rows) ?? buildLocalValidation(rows);
  } catch {
    return buildLocalValidation(rows);
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
