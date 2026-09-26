/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClaimReceipt, ClaimReceiptData } from '../ClaimReceipt';

// Mock dependencies
jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

jest.mock('@/lib/explorer', () => ({
  buildExplorerUrl: (type: string, id: string) =>
    `https://stellar.expert/explorer/testnet/${type}/${id}`,
}));

const baseClaim: ClaimReceiptData = {
  claimId: 'claim-123',
  packageId: 'pkg-abc',
  status: 'disbursed',
  amount: 100,
  timestamp: '2024-01-15T10:30:00Z',
};

const fullClaim: ClaimReceiptData = {
  ...baseClaim,
  transactionHash: 'abc123txhash',
  contractAddress: 'CCONTRACTADDRESS',
  tokenAddress: 'GTOKENADDRESS',
};

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('ClaimReceipt', () => {
  describe('basic rendering', () => {
    it('renders claim id and package id', () => {
      render(<ClaimReceipt claim={baseClaim} />);
      expect(screen.getByText('claim-123')).toBeInTheDocument();
      expect(screen.getByText('pkg-abc')).toBeInTheDocument();
    });

    it('renders status badge', () => {
      render(<ClaimReceipt claim={baseClaim} />);
      expect(screen.getAllByText('disbursed').length).toBeGreaterThan(0);
    });

    it('renders amount', () => {
      render(<ClaimReceipt claim={baseClaim} />);
      expect(screen.getByText(/100 tokens/)).toBeInTheDocument();
    });

    it('renders formatted timestamp', () => {
      render(<ClaimReceipt claim={baseClaim} />);
      expect(screen.getByText(/Jan 15, 2024/)).toBeInTheDocument();
    });
  });

  describe('explorer links', () => {
    it('shows transaction hash with explorer link', () => {
      render(<ClaimReceipt claim={fullClaim} />);
      const txLink = screen.getByRole('link', { name: /abc123txhash/i });
      expect(txLink).toHaveAttribute(
        'href',
        'https://stellar.expert/explorer/testnet/tx/abc123txhash'
      );
      expect(txLink).toHaveAttribute('target', '_blank');
    });

    it('shows contract address with explorer link', () => {
      render(<ClaimReceipt claim={fullClaim} />);
      const contractLink = screen.getByRole('link', { name: /CCONTRACTADDRESS/i });
      expect(contractLink).toHaveAttribute(
        'href',
        'https://stellar.expert/explorer/testnet/contract/CCONTRACTADDRESS'
      );
    });

    it('shows token address with explorer link', () => {
      render(<ClaimReceipt claim={fullClaim} />);
      const tokenLink = screen.getByRole('link', { name: /GTOKENADDRESS/i });
      expect(tokenLink).toHaveAttribute(
        'href',
        'https://stellar.expert/explorer/testnet/address/GTOKENADDRESS'
      );
    });

    it('does not render tx hash section when transactionHash is absent', () => {
      render(<ClaimReceipt claim={baseClaim} />);
      expect(screen.queryByText(/TRANSACTION HASH/i)).not.toBeInTheDocument();
    });

    it('does not render contract address section when contractAddress is absent', () => {
      render(<ClaimReceipt claim={baseClaim} />);
      expect(screen.queryByText(/CONTRACT ADDRESS/i)).not.toBeInTheDocument();
    });
  });

  describe('per-field copy buttons', () => {
    it('renders copy button for transaction hash', () => {
      render(<ClaimReceipt claim={fullClaim} />);
      expect(
        screen.getByRole('button', { name: /copy transaction hash/i })
      ).toBeInTheDocument();
    });

    it('renders copy button for contract address', () => {
      render(<ClaimReceipt claim={fullClaim} />);
      expect(
        screen.getByRole('button', { name: /copy contract address/i })
      ).toBeInTheDocument();
    });

    it('renders copy button for token address', () => {
      render(<ClaimReceipt claim={fullClaim} />);
      expect(
        screen.getByRole('button', { name: /copy token address/i })
      ).toBeInTheDocument();
    });

    it('copies transaction hash to clipboard on click', async () => {
      render(<ClaimReceipt claim={fullClaim} />);
      const btn = screen.getByRole('button', { name: /copy transaction hash/i });
      fireEvent.click(btn);
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc123txhash')
      );
    });

    it('copies contract address to clipboard on click', async () => {
      render(<ClaimReceipt claim={fullClaim} />);
      const btn = screen.getByRole('button', { name: /copy contract address/i });
      fireEvent.click(btn);
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('CCONTRACTADDRESS')
      );
    });
  });

  describe('full receipt copy', () => {
    it('copies full receipt text when Copy button is clicked', async () => {
      render(<ClaimReceipt claim={baseClaim} />);
      const copyBtn = screen.getByTitle('Copy to clipboard');
      fireEvent.click(copyBtn);
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          expect.stringContaining('claim-123')
        )
      );
    });

    it('shows "Copied" feedback after copying', async () => {
      render(<ClaimReceipt claim={baseClaim} />);
      const copyBtn = screen.getByTitle('Copy to clipboard');
      fireEvent.click(copyBtn);
      await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    });
  });

  describe('compact mode', () => {
    it('renders package id in compact mode', () => {
      render(<ClaimReceipt claim={baseClaim} compact />);
      expect(screen.getByText('pkg-abc')).toBeInTheDocument();
    });

    it('does not render action buttons in compact mode', () => {
      render(<ClaimReceipt claim={baseClaim} compact />);
      expect(screen.queryByTitle('Copy to clipboard')).not.toBeInTheDocument();
    });
  });

  describe('share callback', () => {
    it('calls onShare when Share button is clicked', async () => {
      const onShare = jest.fn().mockResolvedValue(undefined);
      render(<ClaimReceipt claim={baseClaim} onShare={onShare} />);
      const shareBtn = screen.getByTitle('Share receipt');
      fireEvent.click(shareBtn);
      await waitFor(() => expect(onShare).toHaveBeenCalledTimes(1));
    });
  });

  describe('download', () => {
    it('renders Download button', () => {
      render(<ClaimReceipt claim={baseClaim} />);
      expect(screen.getByTitle('Download receipt')).toBeInTheDocument();
    });
  });
});
