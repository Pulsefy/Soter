import {
  parsePendingWithdrawal,
  readAmountString,
  readTimestampNumber,
  timelockRemainingSeconds,
} from './pending-withdrawal';

const TO = `G${'A'.repeat(55)}`;
const TOKEN = `C${'A'.repeat(55)}`;

describe('readAmountString', () => {
  it('reads a bigint without losing precision', () => {
    expect(readAmountString(9007199254740993n)).toBe('9007199254740993');
  });

  it('passes a decimal string through trimmed', () => {
    expect(readAmountString('  1000  ')).toBe('1000');
  });

  it('truncates a numeric transport value', () => {
    expect(readAmountString(1000.9)).toBe('1000');
  });

  it('falls back to zero for an unusable value', () => {
    expect(readAmountString(undefined)).toBe('0');
    expect(readAmountString('')).toBe('0');
  });
});

describe('readTimestampNumber', () => {
  it('widens a bigint u64', () => {
    expect(readTimestampNumber(1789000000n)).toBe(1789000000);
  });

  it('parses a string transport value', () => {
    expect(readTimestampNumber('1789000000')).toBe(1789000000);
  });

  it('falls back to zero for an unusable value', () => {
    expect(readTimestampNumber(null)).toBe(0);
    expect(readTimestampNumber('not-a-number')).toBe(0);
  });
});

describe('parsePendingWithdrawal', () => {
  it('parses the object form of a decoded struct', () => {
    expect(
      parsePendingWithdrawal({
        to: TO,
        token: TOKEN,
        amount: 5000n,
        executable_at: 1789000000n,
      }),
    ).toEqual({ to: TO, token: TOKEN, amount: '5000', executableAt: 1789000000 });
  });

  it('parses the Map form some SDK versions decode to', () => {
    expect(
      parsePendingWithdrawal(
        new Map<string, unknown>([
          ['to', TO],
          ['token', TOKEN],
          ['amount', '5000'],
          ['executable_at', 1789000000],
        ]),
      ),
    ).toEqual({ to: TO, token: TOKEN, amount: '5000', executableAt: 1789000000 });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('returns null for %s, the None case', (_label, raw) => {
    expect(parsePendingWithdrawal(raw)).toBeNull();
  });

  it('returns null when there is no destination to pay', () => {
    expect(
      parsePendingWithdrawal({ token: TOKEN, amount: '1', executable_at: 1 }),
    ).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(parsePendingWithdrawal('pending')).toBeNull();
  });
});

describe('timelockRemainingSeconds', () => {
  it('returns the full wait before the executable timestamp', () => {
    expect(
      timelockRemainingSeconds(
        { to: TO, token: TOKEN, amount: '1', executableAt: 2000 },
        1000,
      ),
    ).toBe(1000);
  });

  it('floors at zero once the timelock has elapsed', () => {
    expect(
      timelockRemainingSeconds(
        { to: TO, token: TOKEN, amount: '1', executableAt: 1000 },
        2000,
      ),
    ).toBe(0);
  });

  it('is zero when nothing is pending', () => {
    expect(timelockRemainingSeconds(null)).toBe(0);
  });
});
