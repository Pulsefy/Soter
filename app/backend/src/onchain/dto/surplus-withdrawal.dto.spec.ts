import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProposeSurplusWithdrawalDto } from './surplus-withdrawal.dto';

const VALID_TO = `G${'A'.repeat(55)}`;
const VALID_TOKEN = `C${'A'.repeat(55)}`;

function validate(overrides: Record<string, unknown> = {}) {
  const instance = plainToInstance(ProposeSurplusWithdrawalDto, {
    to: VALID_TO,
    token: VALID_TOKEN,
    amount: '1000000000',
    ...overrides,
  });
  return validateSync(instance, { whitelist: true });
}

describe('ProposeSurplusWithdrawalDto', () => {
  it('accepts a well-formed proposal', () => {
    expect(validate()).toHaveLength(0);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(
      validate({ to: `  ${VALID_TO}  `, amount: ' 1000000000 ' }),
    ).toHaveLength(0);
  });

  describe('to', () => {
    it('rejects a truncated address', () => {
      expect(validate({ to: 'GABC' })).not.toHaveLength(0);
    });

    it('rejects a lower-case address', () => {
      expect(validate({ to: VALID_TO.toLowerCase() })).not.toHaveLength(0);
    });

    it('rejects a missing destination', () => {
      expect(validate({ to: undefined })).not.toHaveLength(0);
    });
  });

  describe('amount', () => {
    it.each([
      ['zero', '0'],
      ['a negative value', '-1'],
      ['a decimal', '1.5'],
      ['an exponent', '1e9'],
      ['a numeric input', 1000],
      ['a hex literal', '0x10'],
      ['an overlong i128', '1'.repeat(40)],
      ['empty', ''],
    ])('rejects %s', (_label, amount) => {
      expect(validate({ amount })).not.toHaveLength(0);
    });

    it('accepts a 39-digit value, the i128 ceiling', () => {
      expect(validate({ amount: '9'.repeat(39) })).toHaveLength(0);
    });
  });

  describe('token', () => {
    it('rejects a missing token', () => {
      expect(validate({ token: undefined })).not.toHaveLength(0);
    });

    it('rejects an address with an unsupported prefix', () => {
      expect(validate({ token: `S${'A'.repeat(55)}` })).not.toHaveLength(0);
    });
  });
});
