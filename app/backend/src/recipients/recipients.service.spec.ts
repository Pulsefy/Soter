import { BadRequestException } from '@nestjs/common';
import { RecipientsService } from './recipients.service';

describe('RecipientsService', () => {
  let service: RecipientsService;

  beforeEach(() => {
    service = new RecipientsService();
  });

  describe('validateImport', () => {
    it('validates rows and summarises statuses', () => {
      const csv = [
        'name,wallet,phone',
        'Alice,GABCDEFGHIJKLM,08012345678',
        'Bob,,08087654321',
        ',GDEFGHIJKLM,',
      ].join('\n');

      const outcome = service.validateImport(csv);

      expect(outcome.summary).toEqual({
        totalRows: 3,
        validRows: 1,
        warningRows: 0,
        errorRows: 2,
      });
      expect(outcome.rows[0].status).toBe('valid');
      expect(outcome.rows[1].messages).toEqual([
        { severity: 'error', field: 'wallet', message: 'Wallet address is required.' },
      ]);
      expect(outcome.rows[2].messages.map(m => m.field)).toEqual(['fullName', 'phone']);
    });

    it('flags short wallet addresses as warnings', () => {
      const outcome = service.validateImport('name,wallet,phone\nAlice,GCAB,123');
      expect(outcome.rows[0].status).toBe('warning');
      expect(outcome.rows[0].messages[0]).toMatchObject({ severity: 'warning', field: 'wallet' });
    });

    it('recognises aliased headers', () => {
      const outcome = service.validateImport('Full Name,Wallet Address,Mobile\nAlice,GABCDEFGHIJKLM,123');
      expect(outcome.rows[0].status).toBe('valid');
      expect(outcome.rows[0].values).toEqual({ name: 'Alice', wallet: 'GABCDEFGHIJKLM', phone: '123' });
    });

    it('handles CRLF line endings and BOM', () => {
      const csv = '\uFEFFname,wallet,phone\r\nAlice,GABCDEFGHIJKLM,123\r\n';
      const outcome = service.validateImport(csv);
      expect(outcome.summary.totalRows).toBe(1);
      expect(outcome.rows[0].values.name).toBe('Alice');
    });

    it('rejects empty input', () => {
      expect(() => service.validateImport('')).toThrow(BadRequestException);
      expect(() => service.validateImport('   \n  ')).toThrow(BadRequestException);
    });

    it('rejects files without headers', () => {
      expect(() => service.validateImport(',,,')).toThrow(BadRequestException);
    });
  });

  describe('buildImportReport', () => {
    const csv = [
      'name,wallet,phone',
      'Alice,GABCDEFGHIJKLM,08012345678',
      'Bob,,08087654321',
      'Needs "Quotes",GDEFGHIJKLM,',
    ].join('\n');

    it('produces a structured CSV with metadata and one record per message', () => {
      const outcome = service.validateImport(csv);
      const report = service.buildImportReport('camp-42', outcome);

      expect(report.meta.campaignId).toBe('camp-42');
      expect(report.meta.filename).toBe('recipient-import-report-camp-42.csv');

      const lines = report.csv.split('\n');
      expect(lines[0]).toBe('# Soter recipient import validation report');
      expect(lines).toContain('# campaignId: camp-42');
      expect(lines).toContain('# source: backend');
      expect(lines).toContain('# totalRows: 3');
      expect(lines).toContain('# errorRows: 1');
      expect(lines).toContain('rowNumber,status,severity,field,message,name,wallet,phone');

      // Row 2 has a missing wallet → one error record.
      expect(lines).toContain('2,error,error,wallet,Wallet address is required.,Bob,,08087654321');
      // Row 3 message contains quotes → value is CSV-escaped.
      expect(lines.some(line => line.startsWith('3,') && line.includes('"Needs ""Quotes"""'))).toBe(true);
    });

    it('emits a single record for rows without messages', () => {
      const outcome = service.validateImport('name,wallet,phone\nAlice,GABCDEFGHIJKLM,123');
      const report = service.buildImportReport('camp-1', outcome);
      const body = report.csv.split('\n').filter(line => line.startsWith('1,'));
      expect(body).toEqual(['1,valid,,,,Alice,GABCDEFGHIJKLM,123']);
    });
  });
});
