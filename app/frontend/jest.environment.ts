import { TextDecoder, TextEncoder } from 'node:util';

import JSDOMEnvironment from 'jest-environment-jsdom';

/**
 * jsdom does not expose the fetch primitives that Node ships as globals, which
 * breaks suites that construct `Response`/`Request` (WebAuthn service, mock API
 * client) or rely on `TextEncoder`/`TextDecoder`.
 *
 * This environment keeps jsdom's DOM but bridges the missing primitives straight
 * from Node's own runtime, so no polyfill dependency is needed and the real
 * Node implementations are used. Existing globals are never overwritten.
 */
const NODE_GLOBALS_TO_BRIDGE = [
  'Response',
  'Request',
  'Headers',
  'fetch',
  'FormData',
  'Blob',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'MessagePort',
  'MessageChannel',
  'TextEncoder',
  'TextDecoder',
] as const;

export default class FrontendJestEnvironment extends JSDOMEnvironment {
  override async setup(): Promise<void> {
    await super.setup();

    const sandbox = this.global as unknown as Record<string, unknown>;
    const nodeGlobals = globalThis as unknown as Record<string, unknown>;

    for (const key of NODE_GLOBALS_TO_BRIDGE) {
      if (typeof sandbox[key] === 'undefined' && typeof nodeGlobals[key] !== 'undefined') {
        sandbox[key] = nodeGlobals[key];
      }
    }

    // node:util provides these even if the host realm exposes them differently.
    sandbox.TextEncoder ??= TextEncoder;
    sandbox.TextDecoder ??= TextDecoder;
  }
}
