import { assertConsistentState, runScenario, writeReport } from '../harness';
import type { ScenarioResult } from '../harness';
const { sharedDeviceLowBatteryFixture } = require('../fixtures/shared-device-lowBattery.fixture');

/**
 * End-to-end coverage for the interaction between shared-device session
 * clears, low battery, mid-flight evidence uploads, and degraded network.
 *
 * Each scenario combines at least two of those conditions and asserts that
 * the app settles into a consistent state: no stuck queue items and no
 * orphaned uploads.
 */

function runAll(): ScenarioResult[] {
  return sharedDeviceLowBatteryFixture.scenarios.map((scenario) => {
    const result = runScenario(scenario);
    try {
      assertConsistentState(result.finalState);
    } catch (err) {
      result.passed = false;
      result.errors.push(`Invariant check failed: ${(err as Error).message}`);
    }
    return result;
  });
}

describe('shared-device + low battery interactions', () => {
  const results: ScenarioResult[] = [];

  afterAll(() => {
    writeReport(results);
  });

  for (const scenario of sharedDeviceLowBatteryFixture.scenarios) {
    it(scenario.name, () => {
      const result = runScenario(scenario);
      results.push(result);
      expect(result.errors).equal([]);
      expect(result.passed).toBe(true);
      // The combined scenario must always settle into a consistent state.
      expect(() => assertConsistentState(result.finalState)).not.toThrow();
    });
  }

  it('settles all scenarios with no stuck or orphaned work', () => {
    const all = runAll();
    for (const result of all) {
      expect(result.errors, result.name).equal([]);
      expect(result.passed, result.name).toBe(true);
    }
  });
});

export { runAll };
