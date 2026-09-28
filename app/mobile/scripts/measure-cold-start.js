#!/usr/bin/env node
/**
 * Cold-start-to-interactive measurement CLI (issue #931).
 *
 * Drives a connected Android device or emulator through repeated cold
 * starts of the Soter mobile app, reads the phase timestamps logged by
 * `src/startup/coldStartTracker.ts` out of `adb logcat`, and fails (exit
 * code 1) if the median time-to-interactive exceeds the budget committed
 * in `perf/cold-start-budget.json`.
 *
 * See ../COLD_START_BUDGET.md for what this measures, how to run it
 * locally, and how CI runs it against a low-end device profile.
 *
 * Usage:
 *   node scripts/measure-cold-start.js [options]
 *
 * Options:
 *   --package <id>      Android application id (default: from app.json)
 *   --activity <name>   Launcher activity, relative or full (default: .MainActivity)
 *   --iterations <n>    Cold starts to sample (default: from the budget file, or 5)
 *   --device <serial>   `adb -s <serial>` target (default: whichever single device is connected)
 *   --budget <path>     Budget JSON path (default: perf/cold-start-budget.json)
 *   --out <path>        Report output path without extension (default: perf/cold-start-report)
 *   --timeout-ms <n>    Max time to wait for the interactive log line per iteration (default: 15000)
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  PHASE_ORDER,
  parseColdStartLogLines,
  computePhaseDurations,
  aggregateMeasurements,
  evaluateBudget,
} = require('./coldStartAnalysis');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = {
    activity: '.MainActivity',
    timeoutMs: 15000,
    budget: path.join(ROOT, 'perf', 'cold-start-budget.json'),
    out: path.join(ROOT, 'perf', 'cold-start-report'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--package':
        args.package = value;
        i += 1;
        break;
      case '--activity':
        args.activity = value;
        i += 1;
        break;
      case '--iterations':
        args.iterations = Number(value);
        i += 1;
        break;
      case '--device':
        args.device = value;
        i += 1;
        break;
      case '--budget':
        args.budget = path.resolve(value);
        i += 1;
        break;
      case '--out':
        args.out = path.resolve(value);
        i += 1;
        break;
      case '--timeout-ms':
        args.timeoutMs = Number(value);
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function defaultPackageId() {
  const appJsonPath = path.join(ROOT, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const pkg = appJson.expo?.android?.package;
  if (!pkg) {
    throw new Error(
      `Could not read expo.android.package from ${appJsonPath}; pass --package explicitly.`,
    );
  }
  return pkg;
}

function loadBudget(budgetPath) {
  const raw = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  if (typeof raw.totalMs !== 'number' || typeof raw.toleranceRatio !== 'number') {
    throw new Error(
      `${budgetPath} must define numeric "totalMs" and "toleranceRatio" fields.`,
    );
  }
  return raw;
}

function adb(args, deviceSerial, options = {}) {
  const fullArgs = deviceSerial ? ['-s', deviceSerial, ...args] : args;
  return execFileSync('adb', fullArgs, {
    encoding: 'utf8',
    ...options,
  });
}

/** Host-vs-device clock offset: hostEpochMs - deviceEpochMs. */
function measureClockOffset(deviceSerial) {
  const before = Date.now();
  const deviceTimeRaw = adb(
    ['shell', 'date', '+%s%3N'],
    deviceSerial,
  ).trim();
  const after = Date.now();
  const deviceEpochMs = Number(deviceTimeRaw);
  if (!Number.isFinite(deviceEpochMs)) {
    throw new Error(
      `Could not parse device clock from "adb shell date +%s%3N" output: "${deviceTimeRaw}"`,
    );
  }
  // Split the difference on the round-trip time of the `adb shell` call
  // itself so the offset isn't biased by command latency.
  const hostEpochMsAtDeviceSample = (before + after) / 2;
  return hostEpochMsAtDeviceSample - deviceEpochMs;
}

function waitForInteractiveLog(deviceSerial, timeoutMs) {
  const pollIntervalMs = 250;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const logText = adb(['logcat', '-d'], deviceSerial, {
      maxBuffer: 32 * 1024 * 1024,
    });
    const timestamps = parseColdStartLogLines(logText);
    if (PHASE_ORDER.every(phase => timestamps[phase] !== undefined)) {
      return timestamps;
    }
    if (Date.now() >= deadline) {
      return timestamps; // partial - computePhaseDurations reports what's missing
    }
    execFileSync('sleep', [String(pollIntervalMs / 1000)]);
  }
}

function runOneColdStart({ deviceSerial, packageId, activity, timeoutMs }) {
  adb(['shell', 'am', 'force-stop', packageId], deviceSerial);
  adb(['logcat', '-c'], deviceSerial);

  const deviceToHostOffsetMs = measureClockOffset(deviceSerial);
  const launchWallClockMs = Date.now();

  const componentName = activity.startsWith('.')
    ? `${packageId}/${activity}`
    : `${packageId}/${packageId}.${activity}`;

  let nativeStartOutput = '';
  try {
    nativeStartOutput = adb(
      ['shell', 'am', 'start', '-W', '-n', componentName],
      deviceSerial,
    );
  } catch (err) {
    throw new Error(
      `"adb shell am start -W -n ${componentName}" failed: ${err.message}`,
    );
  }

  const timestamps = waitForInteractiveLog(deviceSerial, timeoutMs);
  const durations = computePhaseDurations({
    timestamps,
    launchWallClockMs,
    deviceToHostOffsetMs,
  });

  const totalTimeMatch = /TotalTime:\s*(\d+)/.exec(nativeStartOutput);

  return {
    ...durations,
    nativeTotalTimeMs: totalTimeMatch ? Number(totalTimeMatch[1]) : null,
  };
}

function toMarkdown({ report, budgetPath, deviceSerial }) {
  const { aggregate, budgetResult, iterations } = report;
  const fmt = ms => (ms === null || ms === undefined ? 'n/a' : `${ms}ms`);

  const lines = [
    '# Cold Start Measurement Report',
    '',
    `- Result: ${budgetResult.pass ? '✅ PASS' : '❌ FAIL'}`,
    `- Device: ${deviceSerial || '(default adb device)'}`,
    `- Iterations: ${aggregate.usableCount}/${aggregate.sampleCount} usable`,
    `- Budget file: \`${path.relative(ROOT, budgetPath)}\``,
    '',
    '## Result',
    '',
    `| Metric | Value |`,
    `| :--- | :--- |`,
    `| Median time to interactive | ${fmt(budgetResult.totalMs)} |`,
    `| Budget | ${fmt(budgetResult.budgetMs)} |`,
    `| Budget + tolerance | ${fmt(budgetResult.allowedMs)} |`,
  ];

  if (budgetResult.reason) {
    lines.push('', `> ${budgetResult.reason}`);
  }

  if (aggregate.medians) {
    lines.push(
      '',
      '## Phase breakdown (median across usable runs)',
      '',
      '| Phase | Median duration |',
      '| :--- | :--- |',
      `| Native process launch → JS start | ${fmt(aggregate.medians.nativeLaunchToJsStartMs)} |`,
      `| JS start → app render start | ${fmt(aggregate.medians.jsStartToAppRenderStartMs)} |`,
      `| App render start → interactive (nav ready) | ${fmt(aggregate.medians.appRenderStartToInteractiveMs)} |`,
      `| **Total: launch → interactive** | **${fmt(aggregate.medians.totalToInteractiveMs)}** |`,
    );
  }

  lines.push(
    '',
    '## Per-iteration raw data',
    '',
    '| # | Native TotalTime | Launch→JS | JS→Render | Render→Interactive | Total |',
    '| :-- | :-- | :-- | :-- | :-- | :-- |',
    ...iterations.map(
      (it, i) =>
        `| ${i + 1} | ${fmt(it.nativeTotalTimeMs)} | ${fmt(it.nativeLaunchToJsStartMs)} | ${fmt(it.jsStartToAppRenderStartMs)} | ${fmt(it.appRenderStartToInteractiveMs)} | ${fmt(it.totalToInteractiveMs)} |`,
    ),
  );

  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageId = args.package || defaultPackageId();
  const budget = loadBudget(args.budget);
  const iterations = args.iterations || budget.iterations || 5;

  console.log(
    `[measure-cold-start] package=${packageId} activity=${args.activity} iterations=${iterations}`,
  );

  const results = [];
  for (let i = 0; i < iterations; i += 1) {
    console.log(`[measure-cold-start] iteration ${i + 1}/${iterations}...`);
    const result = runOneColdStart({
      deviceSerial: args.device,
      packageId,
      activity: args.activity,
      timeoutMs: args.timeoutMs,
    });
    if (result.missingPhases.length > 0) {
      console.warn(
        `[measure-cold-start] iteration ${i + 1} missing phase(s): ${result.missingPhases.join(', ')}`,
      );
    } else {
      console.log(
        `[measure-cold-start] iteration ${i + 1}: ${result.totalToInteractiveMs}ms to interactive`,
      );
    }
    results.push(result);
  }

  const aggregate = aggregateMeasurements(results);
  const budgetResult = evaluateBudget(aggregate, budget);

  const report = { aggregate, budgetResult, iterations: results };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(`${args.out}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    `${args.out}.md`,
    toMarkdown({ report, budgetPath: args.budget, deviceSerial: args.device }),
  );

  console.log('');
  console.log(
    budgetResult.pass
      ? `[measure-cold-start] PASS: median ${budgetResult.totalMs}ms <= budget ${budgetResult.allowedMs}ms`
      : `[measure-cold-start] FAIL: ${budgetResult.reason}`,
  );
  console.log(
    `[measure-cold-start] report written to ${args.out}.json / ${args.out}.md`,
  );

  process.exitCode = budgetResult.pass ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, defaultPackageId, loadBudget, toMarkdown };
