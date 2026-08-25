import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const budget = JSON.parse(readFileSync(resolve(root, 'performance/startup-budget.json'), 'utf8'));
const outputPath = resolve(process.env.STARTUP_REPORT ?? 'performance/startup-report.json');
const packageName = process.env.STARTUP_PACKAGE ?? 'org.pulsefy.soter.mobile';
const adb = process.env.ADB ?? 'adb';

function adbCommand(args) {
  return execFileSync(adb, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseMarkers(logcat) {
  return [...logcat.matchAll(/SOTER_STARTUP (\{"phase":"([^"]+)","elapsedMs":(\d+)\})/g)]
    .map((match) => ({ phase: match[2], elapsedMs: Number(match[3]) }));
}

function checkReport(report) {
  const allowedMs = Math.round(budget.budgetMs * (1 + budget.tolerancePct / 100));
  const measurements = report.runs
    .map((run) => run.phases.find((phase) => phase.phase === 'navigation_ready')?.elapsedMs)
    .filter((value) => Number.isFinite(value));
  if (measurements.length !== report.runs.length) {
    throw new Error(`Missing navigation_ready marker in ${report.runs.length - measurements.length} run(s)`);
  }
  const worstMs = Math.max(...measurements);
  report.summary = { worstMs, allowedMs, budgetMs: budget.budgetMs, tolerancePct: budget.tolerancePct };
  return worstMs <= allowedMs;
}

if (process.argv.includes('--dry-run')) {
  const report = { runs: [{ phases: parseMarkers(process.env.STARTUP_LOG ?? '') }] };
  const withinBudget = checkReport(report);
  console.log(JSON.stringify(report.summary));
  process.exit(withinBudget ? 0 : 1);
}

const runs = [];
for (let iteration = 1; iteration <= budget.iterations; iteration += 1) {
  adbCommand(['shell', 'am', 'force-stop', packageName]);
  adbCommand(['logcat', '-c']);
  adbCommand(['shell', 'monkey', '-p', packageName, '1']);
  const phases = parseMarkers(adbCommand(['logcat', '-d', '-s', 'ReactNativeJS:V']));
  runs.push({ iteration, phases });
  adbCommand(['shell', 'am', 'force-stop', packageName]);
}

const report = { profile: budget.profile, device: budget.device, metric: budget.metric, runs };
const withinBudget = checkReport(report);
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Startup report written to ${outputPath}`);
console.log(JSON.stringify(report.summary));
if (!withinBudget) process.exit(1);