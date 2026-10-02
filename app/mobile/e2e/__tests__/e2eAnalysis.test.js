'use strict';

const {
  FLOW_ORDER,
  airplaneModeCommands,
  decodeXml,
  parseJUnitReport,
  evaluateRun,
  classifyArtifacts,
  formatReportMarkdown,
} = require('../e2eAnalysis');

describe('FLOW_ORDER', () => {
  it('covers scan, evidence capture, offline queue and sync-on-reconnect', () => {
    expect(FLOW_ORDER.map(f => f.id)).toEqual([
      'scan',
      'evidence-capture',
      'offline-queue',
      'sync-on-reconnect',
    ]);
  });

  it('puts offline before reconnect so the transition is exercised in order', () => {
    const offlineIndex = FLOW_ORDER.findIndex(f => f.network === 'offline');
    const reconnectIndex = FLOW_ORDER.findIndex(f => f.network === 'reconnect');
    expect(offlineIndex).toBeGreaterThanOrEqual(0);
    expect(reconnectIndex).toBeGreaterThan(offlineIndex);
  });

  it('uses .yaml flow filenames', () => {
    for (const flow of FLOW_ORDER) {
      expect(flow.file).toMatch(/\.yaml$/);
    }
  });
});

describe('airplaneModeCommands', () => {
  it('enables airplane mode via the connectivity service first', () => {
    const { primary } = airplaneModeCommands(true);
    expect(primary).toEqual([
      'shell',
      'cmd',
      'connectivity',
      'airplane-mode',
      'enable',
    ]);
  });

  it('disables airplane mode via the connectivity service first', () => {
    expect(airplaneModeCommands(false).primary).toEqual([
      'shell',
      'cmd',
      'connectivity',
      'airplane-mode',
      'disable',
    ]);
  });

  it('provides a settings + broadcast fallback for older API levels', () => {
    const { fallback } = airplaneModeCommands(true);
    expect(fallback).toHaveLength(2);
    expect(fallback[0]).toEqual([
      'shell',
      'settings',
      'put',
      'global',
      'airplane_mode_on',
      '1',
    ]);
    expect(fallback[1]).toEqual([
      'shell',
      'am',
      'broadcast',
      '-a',
      'android.intent.action.AIRPLANE_MODE',
      '--ez',
      'state',
      'true',
    ]);
  });

  it('sets state=false on the broadcast when disabling', () => {
    expect(airplaneModeCommands(false).fallback[1]).toContain('false');
  });
});

describe('decodeXml', () => {
  it('decodes the entities that appear in JUnit attribute values', () => {
    expect(decodeXml('a &lt; b &amp;&amp; c &gt; d &quot;q&quot;')).toBe(
      'a < b && c > d "q"',
    );
  });
});

describe('parseJUnitReport', () => {
  it('parses a passing report', () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<testsuites>',
      '  <testsuite name="scan" tests="1" failures="0" errors="0" skipped="0" time="4.2">',
      '    <testcase name="scan valid QR" classname="scan" time="4.2"/>',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n');

    const report = parseJUnitReport(xml);
    expect(report.tests).toBe(1);
    expect(report.failures).toBe(0);
    expect(report.cases[0]).toMatchObject({
      name: 'scan valid QR',
      classname: 'scan',
      status: 'passed',
      message: null,
    });
    expect(report.cases[0].timeMs).toBe(4200);
  });

  it('classifies failures, errors and skips, and decodes their messages', () => {
    const xml = [
      '<testsuites>',
      '  <testsuite name="mixed" tests="3">',
      '    <testcase name="fails" classname="queue">',
      '      <failure message="expected &quot;Queued&quot; but got &quot;Failed&quot;">stack</failure>',
      '    </testcase>',
      '    <testcase name="errors" classname="sync">',
      '      <error message="boom">trace</error>',
      '    </testcase>',
      '    <testcase name="self-closing skip" classname="x"><skipped/></testcase>',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n');

    const report = parseJUnitReport(xml);
    expect(report.tests).toBe(3);
    expect(report.failures).toBe(1);
    expect(report.errors).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.cases[0].status).toBe('failed');
    expect(report.cases[0].message).toBe(
      'expected "Queued" but got "Failed"',
    );
    expect(report.cases[1].status).toBe('error');
    expect(report.cases[2].status).toBe('skipped');
  });

  it('returns empty totals for an empty or malformed report', () => {
    expect(parseJUnitReport('')).toMatchObject({
      tests: 0,
      failures: 0,
      errors: 0,
      skipped: 0,
      cases: [],
    });
    expect(parseJUnitReport('<not-junit>')).toMatchObject({ tests: 0 });
    expect(parseJUnitReport(undefined)).toMatchObject({ tests: 0 });
  });
});

describe('evaluateRun', () => {
  it('passes when at least one case ran and none failed', () => {
    const result = evaluateRun([
      { id: 'scan', cases: [{ name: 'a', status: 'passed', message: null }] },
      { id: 'queue', cases: [{ name: 'b', status: 'skipped', message: null }] },
    ]);

    expect(result).toMatchObject({
      pass: true,
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
    });
    expect(result.failedCases).toEqual([]);
  });

  it('fails when any case failed and reports which flow it came from', () => {
    const result = evaluateRun([
      { id: 'scan', cases: [{ name: 'ok', status: 'passed', message: null }] },
      {
        id: 'sync-on-reconnect',
        cases: [
          { name: 'syncs', status: 'failed', message: 'no items appeared' },
          { name: 'second', status: 'error', message: null },
        ],
      },
    ]);

    expect(result.pass).toBe(false);
    expect(result.failed).toBe(2);
    expect(result.failedCases).toEqual([
      { flow: 'sync-on-reconnect', name: 'syncs', message: 'no items appeared' },
      { flow: 'sync-on-reconnect', name: 'second', message: null },
    ]);
  });

  it('fails when no case ran at all (Maestro produced no report)', () => {
    expect(evaluateRun([{ id: 'scan', cases: [] }]).pass).toBe(false);
    expect(evaluateRun([]).pass).toBe(false);
    expect(evaluateRun(undefined).pass).toBe(false);
  });
});

describe('classifyArtifacts', () => {
  it('routes manifest entries into screenshot, log and hierarchy buckets', () => {
    const manifest = {
      entries: [
        { kind: 'screenshot', relativePath: 'screenshots/step-001.png' },
        { kind: 'log', relativePath: 'logs/device-logcat.txt' },
        { kind: 'log', relativePath: 'logs/crash-report.txt' },
        { kind: 'hierarchy', relativePath: 'screen-hierarchy/step-001.json' },
        { kind: 'metadata', relativePath: 'commands.json' },
      ],
    };

    expect(classifyArtifacts(manifest)).toEqual({
      screenshots: ['screenshots/step-001.png'],
      logs: ['logs/device-logcat.txt', 'logs/crash-report.txt'],
      hierarchies: ['screen-hierarchy/step-001.json'],
      other: ['commands.json'],
    });
  });

  it('accepts a bare array and ignores entries without a path', () => {
    const result = classifyArtifacts([
      { relativePath: 'screenshots/a.jpg' },
      { kind: 'x' },
      null,
    ]);
    expect(result.screenshots).toEqual(['screenshots/a.jpg']);
    expect(result.logs).toEqual([]);
  });

  it('returns empty buckets for an empty manifest', () => {
    expect(classifyArtifacts({})).toEqual({
      screenshots: [],
      logs: [],
      hierarchies: [],
      other: [],
    });
    expect(classifyArtifacts(undefined).screenshots).toEqual([]);
  });
});

describe('formatReportMarkdown', () => {
  const report = {
    pass: false,
    startedAt: '2026-09-30T00:00:00.000Z',
    device: 'emulator-5554',
    appPackage: 'org.pulsefy.soter.mobile',
    artifactsDir: 'e2e/artifacts',
    evaluate: {
      pass: false,
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      failedCases: [
        { flow: 'sync-on-reconnect', name: 'syncs', message: 'no items' },
      ],
    },
    flows: [
      {
        id: 'scan',
        file: 'scan-valid-qr.yaml',
        network: 'online',
        status: 'passed',
        tests: 1,
        failures: 0,
      },
      {
        id: 'sync-on-reconnect',
        file: 'sync-on-reconnect.yaml',
        network: 'reconnect',
        status: 'failed',
        tests: 1,
        failures: 1,
      },
    ],
  };

  it('includes the result, device, flows and failures', () => {
    const markdown = formatReportMarkdown(report);
    expect(markdown).toContain('# Mobile End-to-End Report');
    expect(markdown).toContain('❌ FAIL');
    expect(markdown).toContain('emulator-5554');
    expect(markdown).toContain('org.pulsefy.soter.mobile');
    expect(markdown).toContain('sync-on-reconnect.yaml');
    expect(markdown).toContain('## Failures');
    expect(markdown).toContain('no items');
  });

  it('omits the failures section when everything passed', () => {
    const markdown = formatReportMarkdown({
      ...report,
      pass: true,
      evaluate: { ...report.evaluate, pass: true, failed: 0, failedCases: [] },
    });
    expect(markdown).toContain('✅ PASS');
    expect(markdown).not.toContain('## Failures');
  });
});
