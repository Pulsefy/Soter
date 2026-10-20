import { evaluateNetworkQuality } from '../hooks/useNetworkStatus';

describe('evaluateNetworkQuality', () => {
  it('treats high-latency or lossy requests as degraded even while connected', () => {
    expect(
      evaluateNetworkQuality([
        { latencyMs: 3500, failed: false },
        { latencyMs: 5200, failed: true },
        { latencyMs: 6100, failed: false },
      ]),
    ).toBe('degraded');
  });

  it('keeps healthy connections in the good band', () => {
    expect(
      evaluateNetworkQuality([
        { latencyMs: 260, failed: false },
        { latencyMs: 300, failed: false },
        { latencyMs: 340, failed: false },
      ]),
    ).toBe('good');
  });
});
