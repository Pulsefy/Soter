/**
 * Jest environment: jsdom, plus the fetch stack from the Node realm.
 *
 * `jest-environment-jsdom@29` ships jsdom 20, which implements neither `fetch`
 * nor `Response`. Smoke tests that talk to a real backend over HTTP therefore
 * need those globals, and the test sandbox cannot reach them on its own.
 *
 * This environment file is loaded by the Jest runner itself (outside the test
 * sandbox), so `setup()` still runs in the Node realm: the built-in
 * `fetch`/`Response` can be read from the Node global and handed to the jsdom
 * window. Tests opt in with a docblock:
 *
 * ```ts
 * /** @jest-environment ./jest.jsdom-fetch.environment.js *\/
 * ```
 *
 * Prefer this over the default `jsdom` environment, which leaves the globals
 * undefined. Plain unit tests keep using the repo default (`node`).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest resolves test environments with require().
const jsdomEnvironment = require('jest-environment-jsdom');

const JSDOMEnvironment = jsdomEnvironment.TestEnvironment ?? jsdomEnvironment.default;

/** Globals jsdom does not provide, borrowed from Node's realm. */
const NODE_WEB_GLOBALS = [
  'fetch',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'File',
  'Blob',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'AbortController',
  'AbortSignal',
  'structuredClone',
  'crypto',
  'TextEncoder',
  'TextDecoder',
];

class SoterJSDOMFetchEnvironment extends JSDOMEnvironment {
  async setup() {
    await super.setup();

    // `globalThis` here is the Node global: this module is required by the
    // Jest runner, not by the sandboxed test module registry.
    const nodeGlobal = globalThis;

    for (const name of NODE_WEB_GLOBALS) {
      if (this.global[name] === undefined && nodeGlobal[name] !== undefined) {
        this.global[name] = nodeGlobal[name];
      }
    }
  }

  async teardown() {
    for (const name of NODE_WEB_GLOBALS) {
      delete this.global[name];
    }
    await super.teardown();
  }
}

module.exports = SoterJSDOMFetchEnvironment;
