import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { Account, Keypair, StrKey } from '@stellar/stellar-sdk';
import { SorobanAdapter } from '../soroban.adapter';
import { CONTRACT_ERROR_BY_CODE } from './contract-error-catalog';
import { GENERIC_CONTRACT_ERROR_MESSAGES } from './soroban-error.mapper';

/**
 * Contract error code compatibility test.
 *
 * Enumerates every variant of the contract's `Error` enum straight from the
 * Rust source, so a variant added to the contract without a matching
 * `CONTRACT_ERROR_CATALOG` entry fails here — at the source — instead of
 * surfacing at runtime as the generic "Contract error occurred" message.
 *
 * Each code is then driven through the real `SorobanAdapter`: a stubbed RPC
 * server rejects the simulation with the exact host error the Soroban SDK
 * produces, and the adapter's error mapper must turn it into the catalogued,
 * user-facing message.
 */

const CONTRACT_SOURCE = join(
  __dirname,
  '../../../../onchain/contracts/aid_escrow/src/lib.rs',
);

interface RustErrorVariant {
  name: string;
  code: number;
}

function parseContractErrorEnum(source: string): RustErrorVariant[] {
  const enumMatch = source.match(
    /#\[contracterror\][\s\S]*?pub enum Error\s*\{([\s\S]*?)\n\}/,
  );
  if (!enumMatch) {
    throw new Error(
      `Could not locate the contract Error enum in ${CONTRACT_SOURCE}`,
    );
  }

  return enumMatch[1]
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, '').trim())
    .map(line => line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(\d+)\s*,?$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(([, name, code]) => ({ name, code: Number(code) }));
}

const VARIANTS = parseContractErrorEnum(readFileSync(CONTRACT_SOURCE, 'utf8'));
const CASES = VARIANTS.map(v => [v.code, v.name] as const);

function createAdapter(): SorobanAdapter {
  const config = new ConfigService({
    AID_ESCROW_CONTRACT_ID: StrKey.encodeContract(Buffer.alloc(32, 1)),
    SOROBAN_ADMIN_SECRET_KEY: Keypair.random().secret(),
    SOROBAN_NETWORK: 'testnet',
  });
  return new SorobanAdapter(config);
}

/** Point the adapter at a fake RPC server whose simulations fail with `error`. */
function stubFailingSimulation(adapter: SorobanAdapter, error: string): void {
  const server = {
    getAccount: jest.fn((pubKey: string) =>
      Promise.resolve(new Account(pubKey, '1')),
    ),
    simulateTransaction: jest.fn().mockResolvedValue({ error }),
  };
  jest
    .spyOn(adapter as unknown as { getServer: () => unknown }, 'getServer')
    .mockReturnValue(server);
}

describe('Contract error code compatibility', () => {
  it('discovers the contract Error enum', () => {
    // Guards the parser itself: an empty enumeration would vacuously pass.
    expect(VARIANTS.length).toBeGreaterThanOrEqual(31);
    expect(VARIANTS[0]).toEqual({ name: 'NotInitialized', code: 1 });
  });

  it('has no catalog entries for codes the contract does not define', () => {
    const contractCodes = new Set(VARIANTS.map(v => v.code));
    const orphaned = Object.keys(CONTRACT_ERROR_BY_CODE)
      .map(Number)
      .filter(code => !contractCodes.has(code));
    expect(orphaned).toEqual([]);
  });

  describe.each(CASES)('Error::%s (%s)', (code, name) => {
    it('has a catalog entry with the matching variant name', () => {
      const entry = CONTRACT_ERROR_BY_CODE[code];
      expect(entry).toBeDefined();
      expect(entry.name).toBe(name);
      expect(GENERIC_CONTRACT_ERROR_MESSAGES).not.toContain(entry.meaning);
    });

    it('maps a failed simulation through SorobanAdapter to its specific message', async () => {
      const adapter = createAdapter();
      stubFailingSimulation(
        adapter,
        `HostError: Error(Contract, #${code})\n\nEvent log (newest first): ...`,
      );

      const thrown: unknown = await adapter.isActionPaused('claim').then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(thrown).toBeInstanceOf(Error);

      const mapped = adapter.mapContractError(thrown);
      const entry = CONTRACT_ERROR_BY_CODE[code];
      expect(mapped).toMatchObject({
        statusCode: entry.httpStatusCode,
        message: entry.meaning,
        errorCode: entry.integrationErrorCode,
        details: { error_type: 'contract_error', error_code: code },
      });
    });

    it('maps the numeric SDK error code to its specific message', () => {
      const mapped = createAdapter().mapContractError({ errorCode: code });
      expect(mapped.message).toBe(CONTRACT_ERROR_BY_CODE[code].meaning);
      expect(mapped.details).toMatchObject({ error_code: code });
    });

    it('maps an error message naming the variant to its specific message', () => {
      const mapped = createAdapter().mapContractError(
        new Error(`contract call failed: ${name}`),
      );
      expect(mapped.message).toBe(CONTRACT_ERROR_BY_CODE[code].meaning);
      expect(mapped.details).toMatchObject({ error_name: name });
    });
  });
});
