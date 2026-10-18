'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { FLOW_ORDER } = require('../e2eAnalysis');

const FLOWS_DIR = path.join(__dirname, '..', 'flows');
const APP_DIR = path.join(__dirname, '..', '..', 'src');
const PACKAGE_ID = 'org.pulsefy.soter.mobile';

/** The marker every flow waits for before it touches the app. */
const READY_TEST_ID = 'scan-fab';

const readFlow = flow => ({
  ...flow,
  source: fs.readFileSync(path.join(FLOWS_DIR, flow.file), 'utf8'),
});

const flows = FLOW_ORDER.map(readFlow);

/**
 * All app source plus the mock backend, whitespace-collapsed.
 *
 * Collapsing matters: JSX wraps user-visible copy across lines, so
 * `Offline mode: … device\nreconnects.` only matches an assertion once the
 * newline is folded into a space, exactly as React renders it.
 */
const appSource = (() => {
  const chunks = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Test fixtures quote copy freely; only shipping code counts.
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx|js|json)$/.test(entry.name)) {
        chunks.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(APP_DIR);
  chunks.push(fs.readFileSync(path.join(__dirname, '..', 'mockBackend.js'), 'utf8'));
  return chunks.join('\n').replace(/\s+/g, ' ');
})();

/** Copy assertions (`assertVisible: "…"` / `visible: "…"`), excluding ids and regexes. */
const copyAssertions = flow => {
  const found = [];
  const pattern = /(?:assertVisible|visible):\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(flow.source)) !== null) {
    const value = match[1];
    if (value.includes('.*')) continue;
    found.push(value);
  }
  return found;
};

describe('Maestro flow definitions', () => {
  it('covers every flow in FLOW_ORDER with an existing file', () => {
    for (const flow of flows) {
      expect(flow.source.length).toBeGreaterThan(0);
    }
  });

  it('targets the mobile app and always starts from cleared state', () => {
    for (const flow of flows) {
      expect(flow.source).toContain(`appId: ${PACKAGE_ID}`);
      expect(flow.source).toContain('clearState: true');
    }
  });

  it('waits for the app to render before sending any deep link', () => {
    // Android delivers a deep link to MainActivity regardless of whether the
    // JS runtime is up yet, and React Native drops URL events that arrive
    // before its Linking listener subscribes. A flow that opens a link during
    // the cold start therefore stays on Home and fails on its first
    // assertion, so every openLink must come after the readiness wait.
    const deepLinkFlows = flows.filter(flow => flow.source.includes('openLink'));
    expect(deepLinkFlows.length).toBeGreaterThan(0);

    for (const flow of deepLinkFlows) {
      const readyIndex = flow.source.indexOf(READY_TEST_ID);
      const firstLinkIndex = flow.source.indexOf('openLink');
      expect(readyIndex).toBeGreaterThan(-1);
      expect(readyIndex).toBeLessThan(firstLinkIndex);
    }
  });

  it('only asserts strings the app actually renders', () => {
    // A flow that waits for copy the app never produces burns its full
    // timeout and then fails with an opaque "assertion is false" message.
    for (const flow of flows) {
      for (const copy of copyAssertions(flow)) {
        const normalized = copy.replace(/\s+/g, ' ');
        expect(appSource).toContain(normalized);
      }
    }
  });

  it('centres the upload button before tapping it', () => {
    // `scrollUntilVisible` stops the moment an element is fully inside the
    // viewport — and on this edge-to-edge layout the strip behind the system
    // navigation bar counts as inside it. The tap then lands on the bar's
    // home button (x 580-860 / y 2392-2560 on the CI emulator), which
    // backgrounds the app, so the assertion that follows never sees its
    // copy. Whether the scroll happens to stop above or below the bar
    // depends on the swipe quantum, so the same flow passes on one run and
    // fails on the next; `centerElement: true` removes the luck.
    const commandBlocks = source => source.split(/(?=^- )/m);

    let centred = 0;
    for (const flow of flows) {
      const scrollsForButton = commandBlocks(flow.source).filter(
        block =>
          block.startsWith('- scrollUntilVisible:') &&
          block.includes('id: "upload-evidence-button"'),
      );

      if (flow.source.includes('tapOn:\n    id: "upload-evidence-button"')) {
        // A flow that taps the button must scroll to it first …
        expect(scrollsForButton.length).toBeGreaterThan(0);
      }

      for (const block of scrollsForButton) {
        // … and that scroll must not stop with it behind the navigation bar.
        centred += 1;
        expect(block).toContain('centerElement: true');
      }
    }

    expect(centred).toBeGreaterThan(0);
  });
});
