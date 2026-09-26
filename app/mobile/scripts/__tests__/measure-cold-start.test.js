'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, defaultPackageId, loadBudget, toMarkdown } = require('../measure-cold-start');

describe('parseArgs', () => {
  it('applies documented defaults when no flags are passed', () => {
    const args = parseArgs([]);
    expect(args.activity).toBe('.MainActivity');
    expect(args.timeoutMs).toBe(15000);
    expect(args.package).toBeUndefined();
    expect(args.device).toBeUndefined();
  });

  it('parses every supported flag', () => {
    const args = parseArgs([
      '--package',
      'org.example.app',
      '--activity',
      'MainActivity',
      '--iterations',
      '3',
      '--device',
      'emulator-5554',
      '--timeout-ms',
      '20000',
    ]);

    expect(args.package).toBe('org.example.app');
    expect(args.activity).toBe('MainActivity');
    expect(args.iterations).toBe(3);
    expect(args.device).toBe('emulator-5554');
    expect(args.timeoutMs).toBe(20000);
  });

  it('rejects an unrecognized flag rather than silently ignoring it', () => {
    expect(() => parseArgs(['--bogus', 'value'])).toThrow(/Unknown argument/);
  });
});

describe('defaultPackageId', () => {
  it('reads expo.android.package from the real app.json', () => {
    // This is intentionally not mocked: a wrong package id here would
    // silently point the whole measurement at the wrong app.
    expect(defaultPackageId()).toBe('org.pulsefy.soter.mobile');
  });
});

describe('loadBudget', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-start-budget-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a well-formed budget file', () => {
    const budgetPath = path.join(tmpDir, 'budget.json');
    fs.writeFileSync(
      budgetPath,
      JSON.stringify({ totalMs: 3500, toleranceRatio: 0.15 }),
    );

    const budget = loadBudget(budgetPath);
    expect(budget.totalMs).toBe(3500);
    expect(budget.toleranceRatio).toBe(0.15);
  });

  it('rejects a budget file missing required numeric fields', () => {
    const budgetPath = path.join(tmpDir, 'budget.json');
    fs.writeFileSync(budgetPath, JSON.stringify({ totalMs: 3500 }));

    expect(() => loadBudget(budgetPath)).toThrow(/totalMs.*toleranceRatio/);
  });

  it('loads the real committed budget file used by CI', () => {
    const realBudgetPath = path.join(__dirname, '..', '..', 'perf', 'cold-start-budget.json');
    const budget = loadBudget(realBudgetPath);
    expect(typeof budget.totalMs).toBe('number');
    expect(typeof budget.toleranceRatio).toBe('number');
    expect(budget.totalMs).toBeGreaterThan(0);
  });
});

describe('toMarkdown', () => {
  it('renders a pass report with the phase breakdown table', () => {
    const report = {
      aggregate: {
        sampleCount: 3,
        usableCount: 3,
        medians: {
          nativeLaunchToJsStartMs: 1000,
          jsStartToAppRenderStartMs: 300,
          appRenderStartToInteractiveMs: 1700,
          totalToInteractiveMs: 3000,
        },
      },
      budgetResult: {
        pass: true,
        totalMs: 3000,
        budgetMs: 3500,
        allowedMs: 4025,
      },
      iterations: [
        {
          nativeTotalTimeMs: 1200,
          nativeLaunchToJsStartMs: 1000,
          jsStartToAppRenderStartMs: 300,
          appRenderStartToInteractiveMs: 1700,
          totalToInteractiveMs: 3000,
        },
      ],
    };

    const markdown = toMarkdown({
      report,
      budgetPath: '/repo/app/mobile/perf/cold-start-budget.json',
      deviceSerial: 'emulator-5554',
    });

    expect(markdown).toContain('✅ PASS');
    expect(markdown).toContain('3000ms');
    expect(markdown).toContain('emulator-5554');
    expect(markdown).toContain('Phase breakdown');
  });

  it('renders a fail report including the failure reason', () => {
    const report = {
      aggregate: { sampleCount: 2, usableCount: 2, medians: { totalToInteractiveMs: 4200 } },
      budgetResult: {
        pass: false,
        reason: 'Median cold-start-to-interactive time 4200ms exceeds the budget of 3500ms plus 15% tolerance (4025ms).',
        totalMs: 4200,
        budgetMs: 3500,
        allowedMs: 4025,
      },
      iterations: [],
    };

    const markdown = toMarkdown({
      report,
      budgetPath: '/repo/app/mobile/perf/cold-start-budget.json',
      deviceSerial: undefined,
    });

    expect(markdown).toContain('❌ FAIL');
    expect(markdown).toContain('exceeds the budget');
    expect(markdown).toContain('(default adb device)');
  });
});
