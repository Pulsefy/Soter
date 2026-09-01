/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ValidationReportPanel } from '../import-wizard/ValidationReportPanel';
import { INITIAL_REPORT_PAGE_SIZE, type ValidationRowResult } from '@/lib/csv-validation';

function makeRow(rowNumber: number, status: 'valid' | 'warning' | 'error', name: string): ValidationRowResult {
  const messages =
    status === 'error'
      ? [{ severity: 'error' as const, field: 'wallet', message: 'Wallet address is required.' }]
      : status === 'warning'
        ? [{ severity: 'warning' as const, field: 'wallet', message: 'Wallet address looks shorter than expected.' }]
        : [];

  return {
    rowNumber,
    status,
    values: { name, wallet: status === 'error' ? '' : `GABC${rowNumber}`, phone: `${rowNumber}` },
    messages,
  };
}

const HEADERS = ['name', 'wallet', 'phone'];

describe('ValidationReportPanel', () => {
  it('renders every row for small reports', () => {
    const rows = [makeRow(1, 'valid', 'Alice'), makeRow(2, 'error', 'Bob'), makeRow(3, 'warning', 'Chidi')];
    render(<ValidationReportPanel rows={rows} headers={HEADERS} />);

    expect(screen.getByText('Row 1')).toBeInTheDocument();
    expect(screen.getByText('Row 2')).toBeInTheDocument();
    expect(screen.getByText('Row 3')).toBeInTheDocument();
    expect(screen.queryByText(/Show more rows/i)).not.toBeInTheDocument();
  });

  it('windows large reports and reveals more rows on demand', () => {
    const rows = Array.from({ length: INITIAL_REPORT_PAGE_SIZE + 20 }, (_, i) =>
      makeRow(i + 1, i % 3 === 0 ? 'error' : 'valid', `User${i + 1}`),
    );
    render(<ValidationReportPanel rows={rows} headers={HEADERS} />);

    // Only the first window is rendered.
    expect(screen.getByText(`Row ${INITIAL_REPORT_PAGE_SIZE}`)).toBeInTheDocument();
    expect(screen.queryByText(`Row ${INITIAL_REPORT_PAGE_SIZE + 1}`)).not.toBeInTheDocument();

    const showMore = screen.getByRole('button', { name: /Show more rows/i });
    fireEvent.click(showMore);

    expect(screen.getByText(`Row ${INITIAL_REPORT_PAGE_SIZE + 1}`)).toBeInTheDocument();
  });

  it('filters rows by status', () => {
    const rows = [makeRow(1, 'valid', 'Alice'), makeRow(2, 'error', 'Bob'), makeRow(3, 'error', 'Dele')];
    render(<ValidationReportPanel rows={rows} headers={HEADERS} />);

    fireEvent.click(screen.getByRole('button', { name: /Errors/i }));

    expect(screen.getByText('Row 2')).toBeInTheDocument();
    expect(screen.getByText('Row 3')).toBeInTheDocument();
    expect(screen.queryByText('Row 1')).not.toBeInTheDocument();
    expect(screen.getByText(/2 matching rows/i)).toBeInTheDocument();
  });

  it('searches rows by value, message, and row number', async () => {
    const rows = [makeRow(1, 'valid', 'Alice'), makeRow(2, 'error', 'Bob'), makeRow(3, 'warning', 'Chidi')];
    render(<ValidationReportPanel rows={rows} headers={HEADERS} />);

    const searchBox = screen.getByRole('searchbox');

    fireEvent.change(searchBox, { target: { value: 'Bob' } });
    await waitFor(() => expect(screen.getByText('Row 2')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Row 1')).not.toBeInTheDocument());

    fireEvent.change(searchBox, { target: { value: 'shorter than expected' } });
    await waitFor(() => expect(screen.getByText('Row 3')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Row 2')).not.toBeInTheDocument());

    fireEvent.change(searchBox, { target: { value: '1' } });
    await waitFor(() => expect(screen.getByText('Row 1')).toBeInTheDocument());
  });

  it('shows an empty state when nothing matches', async () => {
    const rows = [makeRow(1, 'valid', 'Alice')];
    render(<ValidationReportPanel rows={rows} headers={HEADERS} />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz-not-present' } });

    await waitFor(() =>
      expect(screen.getByText(/No rows match the current search and filters/i)).toBeInTheDocument(),
    );
  });

  it('clears the search from the result summary', async () => {
    const rows = [makeRow(1, 'valid', 'Alice'), makeRow(2, 'error', 'Bob')];
    render(<ValidationReportPanel rows={rows} headers={HEADERS} />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Bob' } });
    await waitFor(() => expect(screen.queryByText('Row 1')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Clear search/i }));
    await waitFor(() => expect(screen.getByText('Row 1')).toBeInTheDocument());
  });
});
