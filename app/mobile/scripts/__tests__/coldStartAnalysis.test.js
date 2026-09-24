'use strict';

const {
  parseColdStartLogLines,
  computePhaseDurations,
  median,
  aggregateMeasurements,
  evaluateBudget,
} = require('../coldStartAnalysis');

describe('parseColdStartLogLines', () => {
  it('extracts every phase from a realistic logcat dump', () => {
    const logText = [
      '08-31 10:00:00.100  1234  1234 I ReactNativeJS: Running "main"',
      '08-31 10:00:00.150  1234  1234 I ReactNativeJS: [ColdStart] jsStart 1700000000100',
      '08-31 10:00:00.400  1234  1234 I ReactNativeJS: [ColdStart] appRenderStart 1700000000400',
      '08-31 10:00:01.900  1234  1234 I ReactNativeJS: [ColdStart] navigationReady 1700000001900',
    ].join('\n');

    expect(parseColdStartLogLines(logText)).toEqual({
      jsStart: 1700000000100,
      appRenderStart: 1700000000400,
      navigationReady: 1700000001900,
    });
  });

  it('ignores unrelated log lines and unknown phase names', () => {
    const logText = [
      'some noisy unrelated log line',
      '[ColdStart] someUnknownPhase 123',
      '[ColdStart] jsStart 1700000000100',
    ].join('\n');

    expect(parseColdStartLogLines(logText)).toEqual({
      jsStart: 1700000000100,
    });
  });

  it('keeps the first occurrence of a phase, not the last', () => {
    const logText = [
      '[ColdStart] jsStart 1700000000100',
      '[ColdStart] jsStart 1700000009999',
    ].join('\n');

    expect(parseColdStartLogLines(logText).jsStart).toBe(1700000000100);
  });

  it('returns an empty object for a dump with no cold-start markers', () => {
    expect(parseColdStartLogLines('nothing relevant here\n')).toEqual({});
  });
});

describe('computePhaseDurations', () => {
  const launchWallClockMs = 1700000000000;

  it('computes every phase duration when all timestamps are present', () => {
    const result = computePhaseDurations({
      timestamps: {
        jsStart: 1700000001000,
        appRenderStart: 1700000001300,
        navigationReady: 1700000003000,
      },
      launchWallClockMs,
    });

    expect(result).toEqual({
      nativeLaunchToJsStartMs: 1000,
      jsStartToAppRenderStartMs: 300,
      appRenderStartToInteractiveMs: 1700,
      totalToInteractiveMs: 3000,
      missingPhases: [],
    });
  });

  it('applies a device-to-host clock offset before computing durations', () => {
    // Device clock is 5000ms behind the host.
    const result = computePhaseDurations({
      timestamps: {
        jsStart: 996000,
        appRenderStart: 996300,
        navigationReady: 997000,
      },
      launchWallClockMs: 1000000,
      deviceToHostOffsetMs: 5000,
    });

    expect(result.nativeLaunchToJsStartMs).toBe(1000); // (996000+5000) - 1000000
    expect(result.totalToInteractiveMs).toBe(2000); // (997000+5000) - 1000000
  });

  it('reports missing phases and nulls out durations that depend on them', () => {
    const result = computePhaseDurations({
      timestamps: { jsStart: 1700000001000 },
      launchWallClockMs,
    });

    expect(result.missingPhases).toEqual(['appRenderStart', 'navigationReady']);
    expect(result.nativeLaunchToJsStartMs).toBe(1000);
    expect(result.jsStartToAppRenderStartMs).toBeNull();
    expect(result.appRenderStartToInteractiveMs).toBeNull();
    expect(result.totalToInteractiveMs).toBeNull();
  });

  it('reports every phase missing when the log had nothing at all', () => {
    const result = computePhaseDurations({ timestamps: {}, launchWallClockMs });
    expect(result.missingPhases).toEqual([
      'jsStart',
      'appRenderStart',
      'navigationReady',
    ]);
    expect(result.totalToInteractiveMs).toBeNull();
  });
});

describe('median', () => {
  it('returns the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles a single value', () => {
    expect(median([42])).toBe(42);
  });

  it('throws on an empty array rather than returning a misleading value', () => {
    expect(() => median([])).toThrow();
  });
});

describe('aggregateMeasurements', () => {
  function measurement(totalToInteractiveMs, overrides = {}) {
    return {
      nativeLaunchToJsStartMs: 1000,
      jsStartToAppRenderStartMs: 300,
      appRenderStartToInteractiveMs: totalToInteractiveMs
        ? totalToInteractiveMs - 1300
        : null,
      totalToInteractiveMs,
      missingPhases: totalToInteractiveMs === null ? ['navigationReady'] : [],
      ...overrides,
    };
  }

  it('computes the median total across usable runs', () => {
    const aggregate = aggregateMeasurements([
      measurement(3000),
      measurement(3200),
      measurement(2800),
    ]);

    expect(aggregate.sampleCount).toBe(3);
    expect(aggregate.usableCount).toBe(3);
    expect(aggregate.medians.totalToInteractiveMs).toBe(3000);
  });

  it('excludes runs with no usable total from every median', () => {
    const aggregate = aggregateMeasurements([
      measurement(3000),
      measurement(null),
      measurement(3200),
    ]);

    expect(aggregate.sampleCount).toBe(3);
    expect(aggregate.usableCount).toBe(2);
    expect(aggregate.medians.totalToInteractiveMs).toBe(3100);
  });

  it('reports null medians when every run is unusable', () => {
    const aggregate = aggregateMeasurements([measurement(null), measurement(null)]);
    expect(aggregate.usableCount).toBe(0);
    expect(aggregate.medians).toBeNull();
  });
});

describe('evaluateBudget', () => {
  const budget = { totalMs: 3500, toleranceRatio: 0.15 };

  it('passes when the median is within budget', () => {
    const result = evaluateBudget(
      { sampleCount: 5, usableCount: 5, medians: { totalToInteractiveMs: 3000 } },
      budget,
    );
    expect(result.pass).toBe(true);
    expect(result.allowedMs).toBe(4025); // 3500 * 1.15
    expect(result.reason).toBeUndefined();
  });

  it('passes when the median is over budget but within tolerance', () => {
    const result = evaluateBudget(
      { sampleCount: 5, usableCount: 5, medians: { totalToInteractiveMs: 3800 } },
      budget,
    );
    expect(result.pass).toBe(true);
  });

  it('fails when the median exceeds budget plus tolerance', () => {
    const result = evaluateBudget(
      { sampleCount: 5, usableCount: 5, medians: { totalToInteractiveMs: 4200 } },
      budget,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/exceeds the budget/);
  });

  it('fails with a clear reason when there is no usable measurement at all', () => {
    const result = evaluateBudget(
      { sampleCount: 5, usableCount: 0, medians: null },
      budget,
    );
    expect(result.pass).toBe(false);
    expect(result.totalMs).toBeNull();
    expect(result.reason).toMatch(/No usable measurement/);
  });

  it('treats exactly-at-the-tolerance-boundary as passing', () => {
    const result = evaluateBudget(
      { sampleCount: 1, usableCount: 1, medians: { totalToInteractiveMs: 4025 } },
      budget,
    );
    expect(result.pass).toBe(true);
  });
});
