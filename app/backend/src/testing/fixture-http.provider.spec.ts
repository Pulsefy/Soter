import { FixtureHttpProvider } from './fixture-http.provider';

describe('FixtureHttpProvider', () => {
  let provider: FixtureHttpProvider;

  beforeEach(() => {
    provider = new FixtureHttpProvider('stellar');
  });

  it('should return fixture data for getAccount', () => {
    const result = provider.get('getAccount');
    expect(result.id).toBe('GTEST1234567890ABCDEF');
    expect(result.balances).toHaveLength(1);
  });

  it('should return fixture data for submitTransaction', () => {
    const result = provider.get('submitTransaction');
    expect(result.successful).toBe(true);
    expect(result.hash).toContain('fixture');
  });

  it('should throw for an unknown fixture key', () => {
    expect(() => provider.get('nonexistent')).toThrow(
      '[FixtureHttpProvider] No fixture found for key: "nonexistent"',
    );
  });
});
