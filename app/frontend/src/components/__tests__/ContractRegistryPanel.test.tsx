/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContractRegistryPanel } from '../ContractRegistryPanel';
import { useContractRegistry } from '@/hooks/useContractRegistry';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/hooks/useContractRegistry');
jest.mock('@/lib/explorer', () => ({
  buildExplorerUrl: (type: string, id: string, network?: string) =>
    `https://stellar.expert/explorer/${network ?? 'testnet'}/${type}/${id}`,
}));

const mockUseContractRegistry = useContractRegistry as jest.MockedFunction<
  typeof useContractRegistry
>;

const registryData = {
  schema_version: 2,
  generated_at: '2026-09-26T22:36:47.016860+00:00',
  contracts: {
    aid_escrow: {
      version: '0.2.0',
      networks: {
        testnet: {
          contract_id: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
          wasm_hash: '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
          version: '0.1.0',
          deployed_at: '2026-06-03',
        },
      },
    },
  },
};

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('ContractRegistryPanel', () => {
  it('shows a loading state', () => {
    mockUseContractRegistry.mockReturnValue({
      state: 'loading',
      data: null,
      error: null,
      lastChecked: null,
      getContract: jest.fn(),
      findByContractId: jest.fn(),
    });

    render(<ContractRegistryPanel />);
    expect(screen.getByText('registryLoading')).toBeInTheDocument();
  });

  it('shows an error state', () => {
    mockUseContractRegistry.mockReturnValue({
      state: 'error',
      data: null,
      error: new Error('boom'),
      lastChecked: null,
      getContract: jest.fn(),
      findByContractId: jest.fn(),
    });

    render(<ContractRegistryPanel />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('renders contract, network, and deployment metadata, expanded by default', () => {
    mockUseContractRegistry.mockReturnValue({
      state: 'ready',
      data: registryData,
      error: null,
      lastChecked: new Date(),
      getContract: jest.fn(),
      findByContractId: jest.fn(),
    });

    render(<ContractRegistryPanel />);

    expect(screen.getByText('aid_escrow')).toBeInTheDocument();
    expect(screen.getByText('TESTNET')).toBeInTheDocument();
    expect(screen.getByText('2026-06-03')).toBeInTheDocument();
  });

  it('builds the explorer link for the correct network', () => {
    mockUseContractRegistry.mockReturnValue({
      state: 'ready',
      data: registryData,
      error: null,
      lastChecked: new Date(),
      getContract: jest.fn(),
      findByContractId: jest.fn(),
    });

    render(<ContractRegistryPanel />);

    const link = screen.getByRole('link', {
      name: /CDSBJ27PKT.*JG/,
    });
    expect(link).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/contract/CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
    );
  });

  it('copies the contract id to the clipboard', async () => {
    mockUseContractRegistry.mockReturnValue({
      state: 'ready',
      data: registryData,
      error: null,
      lastChecked: new Date(),
      getContract: jest.fn(),
      findByContractId: jest.fn(),
    });

    render(<ContractRegistryPanel />);

    const copyBtn = screen.getByRole('button', {
      name: /registryCopyId: aid_escrow \(testnet\)/,
    });
    fireEvent.click(copyBtn);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
      ),
    );
  });

  it('collapses and re-expands the details on toggle', () => {
    mockUseContractRegistry.mockReturnValue({
      state: 'ready',
      data: registryData,
      error: null,
      lastChecked: new Date(),
      getContract: jest.fn(),
      findByContractId: jest.fn(),
    });

    render(<ContractRegistryPanel defaultExpanded={false} />);
    expect(screen.queryByText('aid_escrow')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('aid_escrow')).toBeInTheDocument();
  });

  it('applies the given id for deep-linking', () => {
    mockUseContractRegistry.mockReturnValue({
      state: 'ready',
      data: registryData,
      error: null,
      lastChecked: new Date(),
      getContract: jest.fn(),
      findByContractId: jest.fn(),
    });

    const { container } = render(<ContractRegistryPanel id="contract-registry" />);
    expect(container.querySelector('#contract-registry')).toBeInTheDocument();
  });
});
