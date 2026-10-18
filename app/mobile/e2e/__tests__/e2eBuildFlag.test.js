'use strict';

const fs = require('node:fs');

const {
  setE2EBuildEnabled,
  FLAG_FILE,
  ENABLED_LINE,
  DISABLED_LINE,
} = require('../enable-e2e-build');

const readFlag = () => fs.readFileSync(FLAG_FILE, 'utf8');

describe('E2E build flag', () => {
  afterEach(() => {
    // Never leave the working tree with the seams enabled.
    setE2EBuildEnabled(false);
  });

  it('is committed disabled so production builds ship no test seams', () => {
    expect(readFlag()).toContain(DISABLED_LINE);
    expect(readFlag()).not.toContain(ENABLED_LINE);
  });

  it('enables the flag when asked', () => {
    const result = setE2EBuildEnabled(true);
    expect(result).toEqual({ changed: true, enabled: true, file: FLAG_FILE });
    expect(readFlag()).toContain(ENABLED_LINE);
    expect(readFlag()).not.toContain(DISABLED_LINE);
  });

  it('is idempotent, so CI retries and re-runs are safe', () => {
    setE2EBuildEnabled(true);
    expect(setE2EBuildEnabled(true).changed).toBe(false);
    expect(readFlag()).toContain(ENABLED_LINE);

    setE2EBuildEnabled(false);
    expect(setE2EBuildEnabled(false).changed).toBe(false);
    expect(readFlag()).toContain(DISABLED_LINE);
  });

  it('restores the committed default', () => {
    setE2EBuildEnabled(true);
    const result = setE2EBuildEnabled(false);
    expect(result).toEqual({ changed: true, enabled: false, file: FLAG_FILE });
    expect(readFlag()).toContain(DISABLED_LINE);
  });
});
