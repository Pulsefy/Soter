/**
 * Pure end-to-end harness logic (issue #932).
 *
 * Deliberately has no `child_process`/`adb`/`fs` dependency so it can be
 * unit tested without a device, emulator, or Maestro install.
 * `e2e/run-e2e.js` is the thin orchestration layer that shells out to
 * `adb` and `maestro` and feeds real data through these functions.
 *
 * Kept as plain CommonJS (not `.mjs`/TypeScript) so the CLI script can
 * `require()` it with no build step and Jest picks it up with no extra
 * config, matching `scripts/coldStartAnalysis.js` (issue #931).
 */

'use strict';

/**
 * The core field flows this harness covers, in execution order.
 *
 * `network` tells the orchestrator what connectivity the flow needs before
 * it starts:
 *   - `online`  — leave the device connected (the default).
 *   - `offline` — put the device in airplane mode first.
 *   - `reconnect` — start in airplane mode, then restore connectivity
 *     *while the app is running* so the sync-on-reconnect path fires.
 *
 * Keep this list in sync with `flows/index` and `E2E_TESTING.md`.
 */
const FLOW_ORDER = [
  { id: 'scan', file: 'scan-valid-qr.yaml', network: 'online' },
  { id: 'evidence-capture', file: 'evidence-capture-queue.yaml', network: 'online' },
  { id: 'offline-queue', file: 'offline-queue.yaml', network: 'offline' },
  { id: 'sync-on-reconnect', file: 'sync-on-reconnect.yaml', network: 'reconnect' },
];

/**
 * `adb` argument lists (excluding `-s <serial>`) that toggle airplane mode.
 *
 * Android's `cmd connectivity airplane-mode` subcommand only exists on
 * newer releases, so a settings write plus the `AIRPLANE_MODE` broadcast is
 * kept as a fallback. Both are tried by the orchestrator; the fallback also
 * covers API 27, the profile used by CI (see E2E_TESTING.md).
 *
 * @param {boolean} enable
 * @returns {{ primary: string[], fallback: string[][] }}
 */
function airplaneModeCommands(enable) {
  const state = enable ? 'enable' : 'disable';
  return {
    primary: ['shell', 'cmd', 'connectivity', 'airplane-mode', state],
    fallback: [
      [
        'shell',
        'settings',
        'put',
        'global',
        'airplane_mode_on',
        enable ? '1' : '0',
      ],
      [
        'shell',
        'am',
        'broadcast',
        '-a',
        'android.intent.action.AIRPLANE_MODE',
        '--ez',
        'state',
        enable ? 'true' : 'false',
      ],
    ],
  };
}

/** Decodes the five XML entities that appear in JUnit attribute values. */
function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&amp;/g, '&');
}

/** Parses a tag's `key="value"` attributes into an object. */
function parseAttributes(attrString) {
  const attrs = {};
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(attrString)) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

/**
 * Parses a Maestro JUnit report (`maestro test --format junit --output …`)
 * into a flat list of test cases plus totals.
 *
 * Tolerant by design: Maestro emits standard JUnit, but a malformed or
 * empty report must fail the run with a clear message rather than throw a
 * parser stack trace.
 *
 * @param {string} xml
 * @returns {{
 *   cases: Array<{ name: string, classname: string, timeMs: number, status: 'passed'|'failed'|'error'|'skipped', message: string|null }>,
 *   tests: number,
 *   failures: number,
 *   errors: number,
 *   skipped: number,
 *   timeMs: number,
 * }}
 */
function parseJUnitReport(xml) {
  const cases = [];
  const text = typeof xml === 'string' ? xml : '';

  const testcasePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match;
  while ((match = testcasePattern.exec(text)) !== null) {
    const attrs = parseAttributes(match[1]);
    const body = match[2] || '';

    let status = 'passed';
    let message = null;

    const failure = /<(failure|error|skipped)\b([^>]*?)(?:\/>|>)/.exec(body);
    if (failure) {
      const kind = failure[1];
      const failureAttrs = parseAttributes(failure[2] || '');
      message = failureAttrs.message || null;
      status = kind === 'skipped' ? 'skipped' : kind === 'error' ? 'error' : 'failed';
    }

    cases.push({
      name: attrs.name || 'unnamed',
      classname: attrs.classname || attrs.name || 'unnamed',
      timeMs: Math.round(Number(attrs.time || 0) * 1000),
      status,
      message,
    });
  }

  const tests = cases.length;
  const failures = cases.filter(c => c.status === 'failed').length;
  const errors = cases.filter(c => c.status === 'error').length;
  const skipped = cases.filter(c => c.status === 'skipped').length;
  const timeMs = cases.reduce((sum, c) => sum + c.timeMs, 0);

  return { cases, tests, failures, errors, skipped, timeMs };
}

/**
 * Reduces the per-flow JUnit results into an overall pass/fail decision and
 * the list of failing cases worth surfacing in the report.
 *
 * A run passes only when it saw at least one case and none failed or errored.
 * Zero cases means the flow never produced a report (e.g. Maestro crashed
 * before running) — treated as a failure, not a silent pass.
 *
 * @param {Array<{ id: string, status?: string, cases?: Array<{name:string,status:string,message:string|null}> }>} flowResults
 * @returns {{ pass: boolean, total: number, passed: number, failed: number, skipped: number, failedCases: Array<{flow:string,name:string,message:string|null}> }}
 */
function evaluateRun(flowResults) {
  const failedCases = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const flow of flowResults || []) {
    const cases = (flow && flow.cases) || [];
    for (const testCase of cases) {
      total += 1;
      if (testCase.status === 'passed') {
        passed += 1;
      } else if (testCase.status === 'skipped') {
        skipped += 1;
      } else {
        failed += 1;
        failedCases.push({
          flow: flow.id || 'unknown',
          name: testCase.name || 'unnamed',
          message: testCase.message || null,
        });
      }
    }
  }

  return {
    pass: total > 0 && failed === 0,
    total,
    passed,
    failed,
    skipped,
    failedCases,
  };
}

/**
 * Classifies the entries of a Maestro artifact `manifest.json` so the
 * orchestrator can copy the right things (screenshots, device logcat, view
 * hierarchies) into the CI artifact bundle without guessing at filenames.
 *
 * @param {{ entries?: Array<object> } | Array<object>} manifest
 * @returns {{ screenshots: string[], logs: string[], hierarchies: string[], other: string[] }}
 */
function classifyArtifacts(manifest) {
  const entries = Array.isArray(manifest)
    ? manifest
    : (manifest && manifest.entries) || [];

  const buckets = {
    screenshots: [],
    logs: [],
    hierarchies: [],
    other: [],
  };

  for (const entry of entries) {
    const relativePath = entry && (entry.relativePath || entry.path);
    if (!relativePath) continue;

    const lower = relativePath.toLowerCase();
    if (/screenshots?\//.test(lower) || /\.(png|jpe?g)$/.test(lower)) {
      buckets.screenshots.push(relativePath);
    } else if (
      /screen-hierarchy\//.test(lower) ||
      /hierarchy.*\.json$/.test(lower)
    ) {
      buckets.hierarchies.push(relativePath);
    } else if (
      /logs?\//.test(lower) ||
      /\.log$/.test(lower) ||
      /logcat.*\.txt$/.test(lower) ||
      /crash-report\.txt$/.test(lower) ||
      /anr-report\.txt$/.test(lower)
    ) {
      buckets.logs.push(relativePath);
    } else {
      buckets.other.push(relativePath);
    }
  }

  return buckets;
}

/**
 * Renders the human-readable report committed as a CI artifact. Kept pure
 * so its shape is pinned by unit tests independently of a real run.
 *
 * @param {{
 *   pass: boolean,
 *   startedAt: string,
 *   device: string|null,
 *   appPackage: string,
 *   evaluate: ReturnType<typeof evaluateRun>,
 *   flows: Array<{ id: string, file: string, network: string, status: string, tests?: number, failures?: number }>,
 *   artifactsDir: string,
 * }} report
 * @returns {string}
 */
function formatReportMarkdown(report) {
  const { evaluate, flows } = report;
  const lines = [
    '# Mobile End-to-End Report',
    '',
    `- Result: ${report.pass ? '✅ PASS' : '❌ FAIL'}`,
    `- Started: ${report.startedAt}`,
    `- Device: ${report.device || '(default adb device)'}`,
    `- App: \`${report.appPackage}\``,
    `- Tests: ${evaluate.passed} passed, ${evaluate.failed} failed, ${evaluate.skipped} skipped`,
    `- Artifacts: \`${report.artifactsDir}\``,
    '',
    '## Flows',
    '',
    '| Flow | Network transition | Result | Tests | Failures |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...flows.map(
      flow =>
        `| ${flow.id} (\`${flow.file}\`) | ${flow.network} | ${flow.status} | ${flow.tests ?? 0} | ${flow.failures ?? 0} |`,
    ),
  ];

  if (evaluate.failedCases.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of evaluate.failedCases) {
      lines.push(
        `- **${failure.flow}** › ${failure.name}${failure.message ? `: ${failure.message}` : ''}`,
      );
    }
  }

  return lines.join('\n') + '\n';
}

module.exports = {
  FLOW_ORDER,
  airplaneModeCommands,
  decodeXml,
  parseAttributes,
  parseJUnitReport,
  evaluateRun,
  classifyArtifacts,
  formatReportMarkdown,
};
