#!/usr/bin/env node
/**
 * End-to-end harness orchestration for the core field flows (issue #932).
 *
 * Runs the Soter mobile app against a real Android emulator/device via
 * Maestro, drives the offline → reconnect transitions with `adb`, and
 * collects screenshots and device logs as CI artifacts.
 *
 * See ../E2E_TESTING.md for what this covers, the app build it expects, and
 * how to run it locally and in CI.
 *
 * Usage:
 *   node e2e/run-e2e.js [options]
 *
 * Options:
 *   --device <serial>       `adb -s <serial>` target (default: the only connected device)
 *   --package <id>          Android application id (default: from app.json)
 *   --apk <path>            Release APK to install (default: android/app/build/outputs/apk/release/app-release.apk)
 *   --api-url <url>         Point the app at an existing backend instead of the bundled mock server
 *   --api-port <n>          Port for the bundled mock backend (default: 3000)
 *   --maestro <bin>         Maestro CLI binary (default: `maestro`)
 *   --flows-dir <path>      Directory of Maestro flow YAML files (default: e2e/flows)
 *   --out <dir>             Artifact/output directory (default: e2e/artifacts)
 *   --report <path>         Report path without extension (default: e2e/report)
 *   --flow <id>             Only run the named flow (repeatable)
 *   --no-install            Skip `adb install` (the app is already installed)
 *   --skip-network          Do not toggle airplane mode (flows must tolerate it)
 *   --reconnect-delay-ms <n> How long the reconnect flow holds offline before the
 *                            harness restores connectivity (default: 60000)
 *
 * The default mock port is 3000 rather than an arbitrary one: it is the port
 * `config.apiUrl` already falls back to on Android (`http://10.0.2.2:3000`),
 * so the app under test reaches the mock backend whether or not the build
 * managed to inline `EXPO_PUBLIC_API_URL`.
 */

'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  FLOW_ORDER,
  airplaneModeCommands,
  parseJUnitReport,
  evaluateRun,
  classifyArtifacts,
  formatReportMarkdown,
} = require('./e2eAnalysis');
const { startMockBackend } = require('./mockBackend');

const ROOT = path.join(__dirname, '..');
const sleepMs = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = {
    apiPort: 3000,
    maestro: 'maestro',
    flowsDir: path.join(__dirname, 'flows'),
    out: path.join(__dirname, 'artifacts'),
    report: path.join(__dirname, 'report'),
    reconnectDelayMs: 60000,
    only: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--device':
        args.device = value;
        i += 1;
        break;
      case '--package':
        args.package = value;
        i += 1;
        break;
      case '--apk':
        args.apk = path.resolve(value);
        i += 1;
        break;
      case '--api-url':
        args.apiUrl = value;
        i += 1;
        break;
      case '--api-port':
        args.apiPort = Number(value);
        i += 1;
        break;
      case '--maestro':
        args.maestro = value;
        i += 1;
        break;
      case '--flows-dir':
        args.flowsDir = path.resolve(value);
        i += 1;
        break;
      case '--out':
        args.out = path.resolve(value);
        i += 1;
        break;
      case '--report':
        args.report = path.resolve(value);
        i += 1;
        break;
      case '--flow':
        args.only.push(value);
        i += 1;
        break;
      case '--reconnect-delay-ms':
        args.reconnectDelayMs = Number(value);
        i += 1;
        break;
      case '--no-install':
        args.noInstall = true;
        break;
      case '--skip-network':
        args.skipNetwork = true;
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

function adb(args, deviceSerial, options = {}) {
  const fullArgs = deviceSerial ? ['-s', deviceSerial, ...args] : args;
  return execFileSync('adb', fullArgs, { encoding: 'utf8', ...options });
}

function adbTry(args, deviceSerial) {
  try {
    return { ok: true, output: adb(args, deviceSerial) };
  } catch (error) {
    return { ok: false, output: error.message };
  }
}

/** Reads the device's airplane-mode setting, or `null` when unavailable. */
function readAirplaneMode(deviceSerial) {
  const state = adbTry(
    ['shell', 'settings', 'get', 'global', 'airplane_mode_on'],
    deviceSerial,
  );
  return state.ok ? state.output.trim() : null;
}

/**
 * Toggles airplane mode and confirms the device actually changed state.
 *
 * `cmd connectivity airplane-mode` only exists on newer Android releases; on
 * older ones (API 27, the CI profile) `cmd` exits successfully after printing
 * "No shell command implementation.", so the exit code alone says nothing
 * about whether the radio state changed. The setting is therefore always read
 * back, and the settings-write + broadcast fallback is applied whenever the
 * modern subcommand did not take effect. Without this, an offline flow runs
 * against a connected device and every offline assertion fails.
 */
async function setAirplaneMode(deviceSerial, enable) {
  const { primary, fallback } = airplaneModeCommands(enable);
  const expected = enable ? '1' : '0';

  adbTry(primary, deviceSerial);
  if (readAirplaneMode(deviceSerial) !== expected) {
    for (const command of fallback) {
      adbTry(command, deviceSerial);
    }
    // The broadcast is handled asynchronously; give it time to land before
    // deciding whether the toggle worked.
    await sleepMs(2000);
  }

  const state = readAirplaneMode(deviceSerial);
  if (state === expected) {
    console.log(`[e2e] airplane mode ${enable ? 'enabled' : 'disabled'}`);
    return true;
  }

  console.warn(
    `[e2e] could not confirm airplane mode ${enable ? 'on' : 'off'} ` +
      `(settings reported "${state}"); continuing`,
  );
  return false;
}

function grantPermissions(deviceSerial, packageId) {
  const permissions = [
    'android.permission.CAMERA',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.POST_NOTIFICATIONS',
  ];
  for (const permission of permissions) {
    // Grants for permissions the target SDK does not define are expected to
    // fail; that is fine and not worth surfacing.
    adbTry(['shell', 'pm', 'grant', packageId, permission], deviceSerial);
  }
}

function ensureAppInstalled(deviceSerial, packageId, apkPath, skipInstall) {
  const installed = adbTry(
    ['shell', 'pm', 'path', packageId],
    deviceSerial,
  );
  const alreadyInstalled = installed.ok && installed.output.includes('package:');

  if (skipInstall) {
    if (!alreadyInstalled) {
      throw new Error(
        `--no-install was passed but ${packageId} is not installed on ${deviceSerial || 'the device'}.`,
      );
    }
    console.log(`[e2e] using already-installed ${packageId}`);
    return;
  }

  if (!fs.existsSync(apkPath)) {
    throw new Error(
      `APK not found at ${apkPath}. Build one (see E2E_TESTING.md) or pass --apk.`,
    );
  }

  console.log(`[e2e] installing ${apkPath}`);
  adb(['install', '-r', apkPath], deviceSerial, { stdio: 'inherit' });
}

function maestroArgs(args, flowFile, junitOut, testOutputDir) {
  return [
    'test',
    '--format',
    'junit',
    '--output',
    junitOut,
    `--test-output-dir=${testOutputDir}`,
    flowFile,
  ];
}

function runMaestro(args, flowFile, junitOut, testOutputDir) {
  return new Promise(resolve => {
    const child = spawn(
      args.maestro,
      maestroArgs(args, flowFile, junitOut, testOutputDir),
      { stdio: 'inherit' },
    );
    child.on('close', code => resolve(code ?? 1));
    child.on('error', error => {
      console.error(`[e2e] failed to start Maestro: ${error.message}`);
      resolve(1);
    });
  });
}

/** Reads each flow's artifact manifest so the report can name what exists. */
function summarizeFlowArtifacts(testOutputDir) {
  const summary = { screenshots: 0, logs: 0, hierarchies: 0 };
  if (!fs.existsSync(testOutputDir)) return summary;

  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'manifest.json') {
        try {
          const buckets = classifyArtifacts(
            JSON.parse(fs.readFileSync(full, 'utf8')),
          );
          summary.screenshots += buckets.screenshots.length;
          summary.logs += buckets.logs.length;
          summary.hierarchies += buckets.hierarchies.length;
        } catch {
          // A malformed manifest must not fail the run.
        }
      }
    }
  };

  walk(testOutputDir);
  return summary;
}

async function runFlow({ args, flow, deviceSerial, skipNetwork }) {
  const flowFile = path.join(args.flowsDir, flow.file);
  if (!fs.existsSync(flowFile)) {
    throw new Error(`Flow file not found: ${flowFile}`);
  }

  const flowOut = path.join(args.out, flow.id);
  fs.mkdirSync(flowOut, { recursive: true });
  const junitOut = path.join(flowOut, 'junit.xml');

  if (!skipNetwork) {
    if (flow.network === 'online' || flow.network === 'reconnect') {
      await setAirplaneMode(deviceSerial, false);
    }
    if (flow.network === 'offline' || flow.network === 'reconnect') {
      await setAirplaneMode(deviceSerial, true);
      // Let NetInfo observe the transition before the flow launches.
      await sleepMs(3000);
    }
  }

  console.log('');
  console.log(`[e2e] running flow "${flow.id}" (${flow.network})`);
  adbTry(['logcat', '-c'], deviceSerial);

  let exitCode;
  if (flow.network === 'reconnect' && !skipNetwork) {
    const maestroPromise = runMaestro(args, flowFile, junitOut, flowOut);
    await sleepMs(args.reconnectDelayMs);
    console.log(
      `[e2e] restoring connectivity for "${flow.id}" after ${args.reconnectDelayMs}ms`,
    );
    await setAirplaneMode(deviceSerial, false);
    exitCode = await maestroPromise;
  } else {
    exitCode = await runMaestro(args, flowFile, junitOut, flowOut);
  }

  // Full device log after the flow, independent of Maestro's own capture.
  const logcat = adbTry(['logcat', '-d'], deviceSerial);
  if (logcat.ok) {
    fs.writeFileSync(path.join(flowOut, 'logcat.txt'), logcat.output);
  }

  let junit = parseJUnitReport('');
  if (fs.existsSync(junitOut)) {
    junit = parseJUnitReport(fs.readFileSync(junitOut, 'utf8'));
  }

  const artifacts = summarizeFlowArtifacts(flowOut);
  const failures = junit.failures + junit.errors;

  return {
    flow: {
      id: flow.id,
      file: flow.file,
      network: flow.network,
      status: failures === 0 && junit.tests > 0 ? 'passed' : 'failed',
      tests: junit.tests,
      failures,
      exitCode,
      artifacts,
    },
    cases: junit.cases,
  };
}

function printUsage() {
  const source = fs.readFileSync(__filename, 'utf8');
  const header = /\/\*\*([\s\S]*?)\*\//.exec(source);
  console.log(header ? header[1].replace(/^ \*/gm, '').trim() : 'node e2e/run-e2e.js');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const packageId = args.package || defaultPackageId();
  const apkPath =
    args.apk ||
    path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

  const flows = FLOW_ORDER.filter(
    flow => args.only.length === 0 || args.only.includes(flow.id),
  );
  if (flows.length === 0) {
    throw new Error(
      `No flows selected. Available: ${FLOW_ORDER.map(f => f.id).join(', ')}`,
    );
  }

  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(args.out, { recursive: true });

  adb(['wait-for-device'], args.device, { stdio: 'inherit' });

  let mockBackend = null;
  let baseUrl = args.apiUrl;
  if (!baseUrl) {
    mockBackend = await startMockBackend({ port: args.apiPort });
    baseUrl = `http://10.0.2.2:${mockBackend.port}`;
    console.log(
      `[e2e] mock backend listening on ${mockBackend.url} (app reaches it at ${baseUrl})`,
    );
    console.log(
      '[e2e] note: the APK must have been built with ' +
        `EXPO_PUBLIC_API_URL=${baseUrl} for the online flows to reach it; the ` +
        `Android build already defaults to http://10.0.2.2:${args.apiPort}`,
    );
  }

  ensureAppInstalled(args.device, packageId, apkPath, args.noInstall);
  grantPermissions(args.device, packageId);

  const startedAt = new Date().toISOString();
  const results = [];
  try {
    for (const flow of flows) {
      results.push(
        await runFlow({
          args,
          flow,
          deviceSerial: args.device,
          skipNetwork: args.skipNetwork,
        }),
      );
    }
  } finally {
    if (mockBackend) {
      await mockBackend.close();
    }
    if (!args.skipNetwork) {
      // Never leave CI's emulator stranded in airplane mode.
      await setAirplaneMode(args.device, false);
    }
  }

  const evaluate = evaluateRun(results.map(r => ({ id: r.flow.id, cases: r.cases })));
  const report = {
    pass: evaluate.pass,
    startedAt,
    device: args.device || null,
    appPackage: packageId,
    apiUrl: baseUrl,
    artifactsDir: path.relative(ROOT, args.out),
    evaluate,
    flows: results.map(r => r.flow),
  };

  fs.writeFileSync(`${args.report}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${args.report}.md`, formatReportMarkdown(report));

  console.log('');
  console.log(
    report.pass
      ? `[e2e] PASS: ${evaluate.passed}/${evaluate.total} checks passed`
      : `[e2e] FAIL: ${evaluate.failed} failing check(s) across ${results.length} flow(s)`,
  );
  console.log(`[e2e] report written to ${args.report}.json / ${args.report}.md`);
  console.log(`[e2e] artifacts in ${args.out}`);

  process.exitCode = report.pass ? 0 : 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[e2e] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, defaultPackageId, setAirplaneMode, summarizeFlowArtifacts };
