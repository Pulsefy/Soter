import { handlers } from './handlers';
import { downloadImportReport, type ValidationResult } from '../csv-validation';

// These tests exercise the mock backend endpoints (what the frontend treats as
// the backend when mocks are enabled), without mocking the fetch client, so the
// full request → handler → report path is covered.

function makeImportForm(csv: string, campaignId = 'camp-77'): FormData {
  const form = new FormData();
  form.append('file', new File([csv], 'recipients.csv', { type: 'text/csv' }));
  form.append('campaignId', campaignId);
  return form;
}

const CSV = 'name,wallet,phone\nAlice,GABCDEFGHIJKLM,123\nBob,,456';

describe('recipients import report mock endpoint', () => {
  it('is registered alongside validate and confirm', () => {
    expect(handlers['/recipients/import/report']).toBeDefined();
    expect(handlers['/recipients/import/validate']).toBeDefined();
    expect(handlers['/recipients/import/confirm']).toBeDefined();
  });

  it('returns a structured CSV attachment with report metadata headers', async () => {
    const response = await handlers['/recipients/import/report'](
      'http://localhost:4000/recipients/import/report',
      { method: 'POST', body: makeImportForm(CSV) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('recipient-import-report-camp-77.csv');
    expect(response.headers.get('X-Report-Id')).toBeTruthy();
    expect(response.headers.get('X-Report-Generated-At')).toBeTruthy();

    const text = await response.text();
    expect(text).toContain('# Soter recipient import validation report');
    expect(text).toContain('# campaignId: camp-77');
    expect(text).toContain('# source: backend');
    expect(text).toContain('# totalRows: 2');
    expect(text).toContain('# errorRows: 1');
    expect(text).toContain('rowNumber,status,severity,field,message,name,wallet,phone');
    expect(text).toContain('1,valid,,,,Alice,GABCDEFGHIJKLM,123');
    expect(text).toContain('2,error,error,wallet,Wallet address is required.,Bob,,456');
  });

  it('rejects requests without form data or a file', async () => {
    const noFormData = await handlers['/recipients/import/report'](
      'http://localhost:4000/recipients/import/report',
      { method: 'POST', body: 'not-form-data' as unknown as FormData },
    );
    expect(noFormData.status).toBe(400);

    const noFile = await handlers['/recipients/import/report'](
      'http://localhost:4000/recipients/import/report',
      { method: 'POST', body: new FormData() },
    );
    expect(noFile.status).toBe(400);
  });

  it('keeps the validate endpoint response shape unchanged', async () => {
    const response = await handlers['/recipients/import/validate'](
      'http://localhost:4000/recipients/import/validate',
      { method: 'POST', body: makeImportForm(CSV) },
    );

    const body = (await response.json()) as {
      success: boolean;
      rows: Array<{ rowNumber: number; status: string; messages: unknown[] }>;
    };
    expect(body.success).toBe(true);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[1]).toMatchObject({ rowNumber: 2, status: 'error' });
    expect(body.rows[0]).not.toHaveProperty('values');
  });
});

describe('downloadImportReport against the mock backend (end-to-end)', () => {
  const fallback: ValidationResult = {
    summary: { totalRows: 0, validRows: 0, warningRows: 0, errorRows: 0 },
    rows: [],
  };

  it('resolves the backend-generated report when the endpoint is available', async () => {
    const file = new File([CSV], 'recipients.csv', { type: 'text/csv' });
    const report = await downloadImportReport('camp-77', file, fallback);

    expect(report.meta.source).toBe('backend');
    expect(report.meta.reportId).toBeTruthy();
    expect(report.filename).toBe('recipient-import-report-camp-77.csv');

    const text = await report.blob.text();
    expect(text).toContain('# source: backend');
    expect(text).toContain('2,error,error,wallet,Wallet address is required.,Bob,,456');
  });
});
