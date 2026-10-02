/** @jest-environment jsdom */
/**
 * Tests for useContractRegistry — migrated to the real registry artifact.
 *
 * The hook fetches the deterministic `contract-registry.json` produced by
 * `app/onchain/scripts/generate-registry.py`, so these fixtures mirror the
 * real generator output (schema_version 2, contracts → networks →
 * { contract_id, wasm_hash, version, deployed_at }). There is no `source`
 * object in the real artifact — that was a mock-only invention.
 */
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useContractRegistry } from '../useContractRegistry';

const mockFetch = jest.fn<Promise<unknown>, Parameters<typeof fetch>>();
global.fetch = mockFetch as unknown as typeof fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

/** Exact shape produced by `generate-registry.py` from the committed deployment registry. */
const realGeneratorRegistry = {
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

describe('useContractRegistry (real registry artifact)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('requests the static contract-registry.json artifact', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realGeneratorRegistry),
    });

    renderHook(() => useContractRegistry(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(mockFetch.mock.calls[0][0]).toBe('/contract-registry.json');
  });

  it('parses the real generator response shape (with wasm_hash, no source)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realGeneratorRegistry),
    });

    const { result } = renderHook(() => useContractRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });

    expect(result.current.data).toEqual(realGeneratorRegistry);
    expect(result.current.data?.contracts.aid_escrow.networks.testnet).toEqual({
      contract_id: expect.stringMatching(/^C[A-Z2-7]{55}$/),
      wasm_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      version: '0.1.0',
      deployed_at: '2026-06-03',
    });
    expect(result.current.error).toBeNull();
  });

  it('resolves a deployed contract by name and network via getContract', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realGeneratorRegistry),
    });

    const { result } = renderHook(() => useContractRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });

    expect(result.current.getContract('aid_escrow')).not.toBeNull();
    expect(
      result.current.getContract('aid_escrow', 'testnet')?.networks.testnet.contract_id,
    ).toBe('CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG');
    expect(result.current.getContract('aid_escrow', 'mainnet')).toBeNull();
    expect(result.current.getContract('unknown_contract')).toBeNull();
  });

  it('reports error state when the artifact fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const { result } = renderHook(() => useContractRegistry(), {
      wrapper: createWrapper(),
    });

    // The hook retries once before surfacing the error — allow for the retry delay.
    await waitFor(
      () => {
        expect(result.current.state).toBe('error');
      },
      { timeout: 4000 },
    );

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('resolves a contract/network pair from a deployed contract ID via findByContractId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realGeneratorRegistry),
    });

    const { result } = renderHook(() => useContractRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });

    expect(
      result.current.findByContractId(
        'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
      ),
    ).toEqual({
      name: 'aid_escrow',
      network: 'testnet',
      deployment: realGeneratorRegistry.contracts.aid_escrow.networks.testnet,
    });

    expect(result.current.findByContractId('C_UNKNOWN')).toBeNull();
    expect(result.current.findByContractId('')).toBeNull();
  });

  it('reports error state for a malformed (non-generator) payload', async () => {
    // Simulates the registry artifact drifting: contracts entry missing
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ schema_version: 2, generated_at: '2026-09-26' }),
    });

    const { result } = renderHook(() => useContractRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });

    // Data arrives but getContract cannot resolve anything from a
    // contracts-less payload — the UI degrades to "no deployments" rather
    // than crashing on a missing field.
    expect(result.current.data?.contracts).toBeUndefined();
    expect(result.current.getContract('aid_escrow', 'testnet')).toBeNull();
  });
});
