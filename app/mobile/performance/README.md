# Mobile startup performance

The benchmark targets a low-end Android emulator: API 35, 2 CPU cores, 1536 MB RAM, cold boots, and snapshots disabled. React Navigation's `navigation_ready` marker defines time to interactive. The report also records `js_entry`, `app_render`, and update-check start/end markers.

From `app/mobile`, install Android SDK and `adb`, create the configured emulator, then run:

```bash
pnpm install
npx expo prebuild --non-interactive
npx expo run:android --variant release
node scripts/startup-performance.mjs
```

The runner writes `performance/startup-report.json` and exits non-zero when the worst of five runs exceeds the 3000 ms budget plus 20% tolerance in `startup-budget.json`. Parser-only validation is available without an emulator:

```bash
STARTUP_LOG='SOTER_STARTUP {"phase":"navigation_ready","elapsedMs":100}' node scripts/startup-performance.mjs --dry-run
```
