import {
  COLD_START_LOG_TAG,
  getColdStartTimestamps,
  markColdStartPhase,
  __resetColdStartTimestampsForTests,
} from '../startup/coldStartTracker';

describe('coldStartTracker', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetColdStartTimestampsForTests();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('records a phase timestamp and logs it in the wire format the analysis script parses', () => {
    const before = Date.now();
    markColdStartPhase('jsStart');
    const after = Date.now();

    const timestamps = getColdStartTimestamps();
    expect(timestamps.jsStart).toBeGreaterThanOrEqual(before);
    expect(timestamps.jsStart).toBeLessThanOrEqual(after);

    const escapedTag = COLD_START_LOG_TAG.replace(/[[\]]/g, '\\$&');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${escapedTag} jsStart \\d+$`)),
    );
  });

  it('does not overwrite a phase that was already recorded', () => {
    markColdStartPhase('appRenderStart');
    const first = getColdStartTimestamps().appRenderStart;

    // Simulate a re-render / Fast Refresh calling the marker again.
    markColdStartPhase('appRenderStart');
    const second = getColdStartTimestamps().appRenderStart;

    expect(second).toBe(first);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  });

  it('tracks each phase independently', () => {
    markColdStartPhase('jsStart');
    markColdStartPhase('appRenderStart');
    markColdStartPhase('navigationReady');

    const timestamps = getColdStartTimestamps();
    expect(Object.keys(timestamps).sort()).toEqual(
      ['appRenderStart', 'jsStart', 'navigationReady'].sort(),
    );
  });

  it('returns an empty snapshot before any phase is marked', () => {
    expect(getColdStartTimestamps()).toEqual({});
  });
});
