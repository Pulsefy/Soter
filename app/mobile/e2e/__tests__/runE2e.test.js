'use strict';

const { parseArgs } = require('../run-e2e');

describe('run-e2e parseArgs', () => {
  it('applies the documented defaults', () => {
    const args = parseArgs([]);
    // 3000 is the app's own Android API fallback: the mock backend has to
    // listen there so an online flow works even if the build lost the inlined
    // EXPO_PUBLIC_API_URL.
    expect(args.apiPort).toBe(3000);
    expect(args.maestro).toBe('maestro');
    // Long enough for the reconnect flow to cold-start, queue its upload and
    // finish its offline assertions before the harness restores connectivity
    // (restoring too early makes the app upload live and the flow's
    // "Upload queued…" assertion fail).
    expect(args.reconnectDelayMs).toBe(120000);
    expect(args.only).toEqual([]);
    expect(args.noInstall).toBeUndefined();
    expect(args.skipNetwork).toBeUndefined();
  });

  it('parses flow selection, device and boolean flags', () => {
    const args = parseArgs([
      '--flow',
      'scan-valid-qr',
      '--flow',
      'offline-queue',
      '--device',
      'emulator-5554',
      '--no-install',
      '--skip-network',
      '--reconnect-delay-ms',
      '15000',
    ]);

    expect(args.only).toEqual(['scan-valid-qr', 'offline-queue']);
    expect(args.device).toBe('emulator-5554');
    expect(args.noInstall).toBe(true);
    expect(args.skipNetwork).toBe(true);
    expect(args.reconnectDelayMs).toBe(15000);
  });

  it('allows the mock backend port to be overridden', () => {
    const args = parseArgs(['--api-port', '8099']);
    expect(args.apiPort).toBe(8099);
  });

  it('rejects unknown arguments instead of silently ignoring them', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});
