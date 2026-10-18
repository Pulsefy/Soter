/**
 * test/contract-bindings.spec.ts
 *
 * Guards the contract-interface pipeline that feeds backend types:
 *   aid_escrow WASM -> app/onchain/contracts/aid_escrow/interface.xdr
 *                    -> src/onchain/generated/aid-escrow.contract.ts
 *
 * These assertions keep the committed artifact canonical and make the
 * generator fail loudly if the contract interface disappears.
 */
import { readFileSync } from 'node:fs';

import {
  SPEC_PATH,
  describeSpec,
  encodeSpec,
  generateBindings,
  loadCommittedSpec,
} from '../scripts/lib/contract-spec';

describe('aid_escrow contract spec artifact', () => {
  it('parses the committed interface spec', () => {
    const spec = loadCommittedSpec();

    expect(spec.entries.length).toBeGreaterThan(0);
    expect(spec.funcs().map(func => func.name().toString())).toEqual(
      expect.arrayContaining([
        'get_aggregates',
        'get_package',
        'view_package_status',
        'create_package',
        'claim',
      ]),
    );
  });

  it('is stored in the canonical base64 XDR stream encoding', () => {
    const spec = loadCommittedSpec();
    const committed = readFileSync(SPEC_PATH, 'utf-8').trim();

    expect(encodeSpec(spec.entries)).toBe(committed);
  });

  it('describes exported functions and types', () => {
    const described = describeSpec(loadCommittedSpec());

    expect(described.get('fn get_aggregates')).toBe('function');
    expect(described.get('type Aggregates')).toBe('struct');
    expect(described.get('type PackageStatus')).toBe('enum');
    expect(described.get('type Error')).toBe('error enum');
  });
});

describe('contract bindings generation', () => {
  const types = generateBindings(loadCommittedSpec());

  it('emits the types the backend call sites depend on', () => {
    expect(types).toContain('export interface Aggregates');
    expect(types).toContain('export interface Package');
    expect(types).toContain('export enum PackageStatus');
  });

  it('maps contract amount fields to bigint', () => {
    expect(types).toMatch(/total_committed: bigint;/);
  });
});
