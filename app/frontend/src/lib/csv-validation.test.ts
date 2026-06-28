import Papa from 'papaparse';
import {
  validateHeaders,
  capValidationErrors,
  MAX_DISPLAY_ERRORS,
  parseRecipientsCsv,
  validateRecipientsImport,
  type ValidationResult,
  type CsvPreviewRow,
} from './csv-validation';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFetchClient = jest.fn();
jest.mock('@/lib/mock-api/client', () => ({
  fetchClient: (...args: unknown[]) => mockFetchClient(...args),
}));

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeFile(content: string, name = 'test.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

function makeValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  const defaultResult: ValidationResult = {
    summary: { totalRows: 0, validRows: 0, warningRows: 0, errorRows: 0 },
    rows: [],
  };
  return { ...defaultResult, ...overrides };
}

// ── validateHeaders ───────────────────────────────────────────────────────────

describe('validateHeaders', () => {
  it('returns valid when all required columns are present', () => {
    const result = validateHeaders(['name', 'wallet', 'phone']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('recognises aliased column names', () => {
    expect(validateHeaders(['Full Name', 'Wallet Address', 'Mobile']).valid).toBe(true);
    expect(validateHeaders(['recipientname', 'publickey', 'phonenumber']).valid).toBe(true);
    expect(validateHeaders(['name', 'stellarwallet', 'phone']).valid).toBe(true);
  });

  it('handles whitespace and punctuation in header names', () => {
    expect(validateHeaders(['full_name', 'wallet-address', 'phone number']).valid).toBe(true);
    expect(validateHeaders(['  Name  ', '  Wallet  ', '  Phone  ']).valid).toBe(true);
  });

  it('flags missing required columns', () => {
    const result = validateHeaders(['name', 'wallet']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].expectedKey).toBe('phone');
    expect(result.errors[0].message).toContain('phone');
  });

  it('flags all missing columns when none are present', () => {
    const result = validateHeaders(['foo', 'bar', 'baz']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map(e => e.expectedKey)).toEqual(['name', 'wallet', 'phone']);
  });

  it('suggests the closest matching header for a misnamed column', () => {
    const result = validateHeaders(['fullname', 'walllet', 'phonenumber']);
    expect(result.valid).toBe(false);

    const walletErr = result.errors.find(e => e.expectedKey === 'wallet');
    expect(walletErr).toBeDefined();
    expect(walletErr!.actualHeader).toBe('walllet');
    expect(walletErr!.suggestion).toContain('walllet');
    expect(walletErr!.suggestion).toContain('wallet');
  });

  it('handles empty headers array', () => {
    const result = validateHeaders([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it('tolerates extra columns', () => {
    expect(validateHeaders(['name', 'wallet', 'phone', 'region', 'notes', 'age']).valid).toBe(true);
  });
});

// ── capValidationErrors ───────────────────────────────────────────────────────

describe('capValidationErrors', () => {
  function makeRow(rowNumber: number, status: 'error' | 'warning' | 'valid') {
    return {
      rowNumber,
      status,
      values: { name: 'Alice', wallet: 'GCABCD', phone: '123' },
      messages: status === 'valid' ? [] : [{ severity: status, message: 'Test' }],
    };
  }

  it('returns all rows when under the cap', () => {
    const rows = Array.from({ length: 3 }, (_, i) => makeRow(i + 1, 'error'));
    const result = makeValidationResult({ rows, summary: { totalRows: 3, validRows: 0, warningRows: 0, errorRows: 3 } });

    const capped = capValidationErrors(result, 10);
    expect(capped.display.rows).toHaveLength(3);
    expect(capped.remainingErrors).toBe(0);
    expect(capped.remainingWarnings).toBe(0);
  });

  it('caps error rows at the specified maximum', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i + 1, 'error'));
    const result = makeValidationResult({ rows, summary: { totalRows: 100, validRows: 0, warningRows: 0, errorRows: 100 } });

    const capped = capValidationErrors(result, 50);
    expect(capped.display.rows.filter(r => r.status === 'error')).toHaveLength(50);
    expect(capped.remainingErrors).toBe(50);
  });

  it('uses default MAX_DISPLAY_ERRORS', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i + 1, 'error'));
    const result = makeValidationResult({ rows, summary: { totalRows: 100, validRows: 0, warningRows: 0, errorRows: 100 } });

    const capped = capValidationErrors(result);
    expect(capped.display.rows.filter(r => r.status === 'error')).toHaveLength(MAX_DISPLAY_ERRORS);
  });

  it('includes warning rows after error cap is exhausted', () => {
    const errorRows = Array.from({ length: 50 }, (_, i) => makeRow(i + 1, 'error'));
    const warningRows = Array.from({ length: 20 }, (_, i) => makeRow(i + 51, 'warning'));
    const result = makeValidationResult({
      rows: [...errorRows, ...warningRows],
      summary: { totalRows: 70, validRows: 0, warningRows: 20, errorRows: 50 },
    });

    const capped = capValidationErrors(result, 60);
    const errorCount = capped.display.rows.filter(r => r.status === 'error').length;
    const warningCount = capped.display.rows.filter(r => r.status === 'warning').length;
    expect(errorCount).toBe(50);
    expect(warningCount).toBe(10);
    expect(capped.remainingErrors).toBe(0);
    expect(capped.remainingWarnings).toBe(10);
  });

  it('preserves valid rows in the display', () => {
    const rows = [
      makeRow(1, 'error'),
      makeRow(2, 'valid'),
      makeRow(3, 'valid'),
    ];
    const result = makeValidationResult({
      rows,
      summary: { totalRows: 3, validRows: 2, warningRows: 0, errorRows: 1 },
    });

    const capped = capValidationErrors(result, 50);
    expect(capped.display.rows).toHaveLength(3);
    expect(capped.display.rows.filter(r => r.status === 'valid')).toHaveLength(2);
  });
});

// ── parseRecipientsCsv ────────────────────────────────────────────────────────

describe('parseRecipientsCsv', () => {
  it('parses a basic CSV with headers', async () => {
    const csv = 'name,wallet,phone\nAlice,GCABCD,123\nBob,GDEFGH,456';
    const file = makeFile(csv);
    const result = await parseRecipientsCsv(file);
    expect(result.headers).toEqual(['name', 'wallet', 'phone']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].values).toEqual({ name: 'Alice', wallet: 'GCABCD', phone: '123' });
    expect(result.rows[1].values).toEqual({ name: 'Bob', wallet: 'GDEFGH', phone: '456' });
  });

  it('skips empty rows', async () => {
    const csv = 'name,wallet,phone\nAlice,GCABCD,123\n\nBob,GDEFGH,456\n\n\n';
    const file = makeFile(csv);
    const result = await parseRecipientsCsv(file);
    expect(result.rows).toHaveLength(2);
  });

  it('trims header names and values', async () => {
    const csv = '  name  ,  wallet  ,  phone  \n  Alice  ,  GCABCD  ,  123  ';
    const file = makeFile(csv);
    const result = await parseRecipientsCsv(file);
    expect(result.headers).toEqual(['name', 'wallet', 'phone']);
    expect(result.rows[0].values.name).toBe('Alice');
  });

  it('rejects when the file has no data', async () => {
    const csv = '';
    const file = makeFile(csv);
    await expect(parseRecipientsCsv(file)).rejects.toThrow('empty');
  });

  it('rejects when the file has only empty lines', async () => {
    const csv = '\n\n\n';
    const file = makeFile(csv);
    await expect(parseRecipientsCsv(file)).rejects.toThrow('empty');
  });

  it('handles incomplete rows gracefully, filling missing fields with empty string', async () => {
    const csv = 'name,wallet,phone\nAlice,GCABCD';
    const file = makeFile(csv);
    const result = await parseRecipientsCsv(file);
    expect(result).toBeDefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].values.name).toBe('Alice');
    expect(result.rows[0].values.wallet).toBe('GCABCD');
  });

  it('fires onProgress during parsing', async () => {
    const csv = 'name,wallet,phone\n' + Array.from({ length: 500 }, (_, i) => `User${i},GC${i},${i}`).join('\n');
    const file = makeFile(csv);
    const progressCalls: Array<{ rowsParsed: number; percent: number }> = [];

    const result = await parseRecipientsCsv(file, (progress) => {
      progressCalls.push({ rowsParsed: progress.rowsParsed, percent: progress.percent });
    });

    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    expect(progressCalls[progressCalls.length - 1].rowsParsed).toBe(result.rows.length);
    expect(progressCalls[progressCalls.length - 1].percent).toBe(100);
  });

  it('handles UTF-8 BOM in CSV', async () => {
    const csv = '\uFEFFname,wallet,phone\nAlice,GCABCD,123';
    const file = makeFile(csv);
    const result = await parseRecipientsCsv(file);
    expect(result.headers).toContain('name');
    expect(result.rows).toHaveLength(1);
  });
});

// ── validateRecipientsImport ─────────────────────────────────────────────────

describe('validateRecipientsImport', () => {
  const campaignId = 'camp-1';
  const rows: CsvPreviewRow[] = [
    { index: 1, values: { name: 'Alice', wallet: 'GCABCD', phone: '123' } },
    { index: 2, values: { name: 'Bob', wallet: 'GDEFGH', phone: '456' } },
    { index: 3, values: { name: '', wallet: '', phone: '' } },
  ];

  function makeFileContent(): File {
    return makeFile('name,wallet,phone\nAlice,GCABCD,123\nBob,GDEFGH,456\n,,');
  }

  beforeEach(() => {
    mockFetchClient.mockReset();
  });

  it('falls back to local validation when backend request fails', async () => {
    mockFetchClient.mockRejectedValue(new Error('Network error'));
    const file = makeFileContent();
    const result = await validateRecipientsImport(campaignId, file, rows);
    expect(result.summary.totalRows).toBe(3);
    expect(result.summary.errorRows).toBe(1); // Row 3 has empty values
  });

  it('falls back to local validation when backend returns non-OK status', async () => {
    mockFetchClient.mockResolvedValue(new Response(null, { status: 500 }));
    const file = makeFileContent();
    const result = await validateRecipientsImport(campaignId, file, rows);
    expect(result.summary.totalRows).toBe(3);
  });

  it('parses backend validation response when valid', async () => {
    const backendRows = [
      { rowNumber: 1, status: 'valid', messages: [] },
      { rowNumber: 2, status: 'error', messages: [{ severity: 'error', field: 'wallet', message: 'Bad wallet' }] },
    ];
    mockFetchClient.mockResolvedValue(
      new Response(JSON.stringify({ success: true, rows: backendRows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const file = makeFileContent();
    const result = await validateRecipientsImport(campaignId, file, rows.slice(0, 2));
    expect(result.summary.totalRows).toBe(2);
    expect(result.summary.errorRows).toBe(1);
    expect(result.rows[1].messages[0].message).toBe('Bad wallet');
  });

  it('fires onProgress during local validation', async () => {
    mockFetchClient.mockRejectedValue(new Error('fail'));
    const file = makeFileContent();
    const progressCalls: Array<{ rowsValidated: number; totalRows: number; percent: number }> = [];

    await validateRecipientsImport(campaignId, file, rows, (progress) => {
      progressCalls.push({
        rowsValidated: progress.rowsValidated,
        totalRows: progress.totalRows,
        percent: progress.percent,
      });
    });

    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    const last = progressCalls[progressCalls.length - 1];
    expect(last.rowsValidated).toBe(3);
    expect(last.totalRows).toBe(3);
    expect(last.percent).toBe(100);
  });
});
