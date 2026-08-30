import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export type ImportRowStatus = 'valid' | 'warning' | 'error';
export type ImportMessageSeverity = 'warning' | 'error';

export interface ImportValidationMessage {
  severity: ImportMessageSeverity;
  field?: string;
  message: string;
}

export interface ImportRowResult {
  rowNumber: number;
  status: ImportRowStatus;
  messages: ImportValidationMessage[];
  values: { name: string; wallet: string; phone: string };
}

export interface ImportValidationSummary {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
}

export interface ImportValidationOutcome {
  summary: ImportValidationSummary;
  rows: ImportRowResult[];
}

export interface ImportReportMeta {
  reportId: string;
  campaignId: string;
  generatedAt: string;
  filename: string;
}

export interface ImportReport {
  meta: ImportReportMeta;
  csv: string;
}

const NAME_HEADERS = ['name', 'fullname', 'recipientname'];
const WALLET_HEADERS = [
  'wallet',
  'walletaddress',
  'stellarwallet',
  'publickey',
];
const PHONE_HEADERS = ['phone', 'phonenumber', 'mobile'];

@Injectable()
export class RecipientsService {
  /**
   * Validates the raw contents of an uploaded recipient CSV and produces
   * row-level results that can be serialized to JSON or a CSV report.
   */
  validateImport(csvText: string): ImportValidationOutcome {
    if (typeof csvText !== 'string' || csvText.trim().length === 0) {
      throw new BadRequestException('The uploaded CSV file is empty.');
    }

    const lines = csvText
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const [headerLine, ...dataLines] = lines;
    const headers = (headerLine ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    if (headers.length === 0) {
      throw new BadRequestException(
        'The uploaded CSV file is missing a header row.',
      );
    }

    const normalizedHeaders = headers.map(header =>
      header.toLowerCase().replace(/[_\s-]+/g, ''),
    );
    const nameIndex = normalizedHeaders.findIndex(header =>
      NAME_HEADERS.includes(header),
    );
    const walletIndex = normalizedHeaders.findIndex(header =>
      WALLET_HEADERS.includes(header),
    );
    const phoneIndex = normalizedHeaders.findIndex(header =>
      PHONE_HEADERS.includes(header),
    );

    const rows = dataLines.map((line, index) => {
      const values = line.split(',').map(value => value.trim());
      const name = nameIndex >= 0 ? (values[nameIndex] ?? '') : '';
      const wallet = walletIndex >= 0 ? (values[walletIndex] ?? '') : '';
      const phone = phoneIndex >= 0 ? (values[phoneIndex] ?? '') : '';
      const messages: ImportValidationMessage[] = [];

      if (!name) {
        messages.push({
          severity: 'error',
          field: 'fullName',
          message: 'Recipient name is required.',
        });
      }

      if (!wallet) {
        messages.push({
          severity: 'error',
          field: 'wallet',
          message: 'Wallet address is required.',
        });
      } else if (wallet.length < 10) {
        messages.push({
          severity: 'warning',
          field: 'wallet',
          message: 'Wallet address looks shorter than expected.',
        });
      }

      if (!phone) {
        messages.push({
          severity: 'warning',
          field: 'phone',
          message: 'Phone number is missing.',
        });
      }

      const status: ImportRowStatus = messages.some(
        message => message.severity === 'error',
      )
        ? 'error'
        : messages.some(message => message.severity === 'warning')
          ? 'warning'
          : 'valid';

      return {
        rowNumber: index + 1,
        status,
        messages,
        values: { name, wallet, phone },
      };
    });

    const summary = rows.reduce<ImportValidationSummary>(
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

  /**
   * Builds a structured CSV import report: metadata comment lines followed by
   * one record per row-level message (severity, field, message) plus the row's
   * key values, so operators can locate and fix failures without the raw file.
   */
  buildImportReport(
    campaignId: string,
    outcome: ImportValidationOutcome,
  ): ImportReport {
    const reportId = `rpt-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
    const generatedAt = new Date().toISOString();

    const metadata = [
      '# Soter recipient import validation report',
      `# reportId: ${reportId}`,
      `# campaignId: ${campaignId}`,
      `# generatedAt: ${generatedAt}`,
      '# source: backend',
      `# totalRows: ${outcome.summary.totalRows}`,
      `# validRows: ${outcome.summary.validRows}`,
      `# warningRows: ${outcome.summary.warningRows}`,
      `# errorRows: ${outcome.summary.errorRows}`,
    ].join('\n');

    const headerRow =
      'rowNumber,status,severity,field,message,name,wallet,phone';
    const bodyLines: string[] = [];

    for (const row of outcome.rows) {
      if (row.messages.length === 0) {
        bodyLines.push(
          [
            row.rowNumber,
            row.status,
            '',
            '',
            '',
            row.values.name,
            row.values.wallet,
            row.values.phone,
          ]
            .map(value => this.escapeCsvValue(String(value)))
            .join(','),
        );
        continue;
      }

      for (const message of row.messages) {
        bodyLines.push(
          [
            row.rowNumber,
            row.status,
            message.severity,
            message.field ?? '',
            message.message,
            row.values.name,
            row.values.wallet,
            row.values.phone,
          ]
            .map(value => this.escapeCsvValue(String(value)))
            .join(','),
        );
      }
    }

    return {
      meta: {
        reportId,
        campaignId,
        generatedAt,
        filename: `recipient-import-report-${campaignId}.csv`,
      },
      csv: `${metadata}\n${headerRow}\n${bodyLines.join('\n')}\n`,
    };
  }

  private escapeCsvValue(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
