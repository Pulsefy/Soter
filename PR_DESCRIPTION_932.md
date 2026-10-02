# Add an End-to-End Test Harness for Core Field Flows

## Description

`app/mobile/src/__tests__/` had 30+ unit-test files but nothing drove the
app the way a field worker does. The critical flows — scan a package,
capture evidence, queue while offline, sync when connectivity returns —
span screens, native permissions, `AsyncStorage`, and NetInfo, so no unit
test can cover them: they only exist as a sequence against a running app.

This PR adds that missing layer: a Maestro-based end-to-end harness that
runs the real app on an Android emulator, plus the CI job, artifact
collection, documentation, and unit tests that make it maintainable.

The app is driven through four user journeys. Connectivity is toggled with
`adb`, so the offline → reconnect transition exercises the real NetInfo
path (`useNetworkStatus` → `flushPendingNetworkActions`), not a mock. Two
deterministic test-mode controls stand in for the two inputs a headless
emulator cannot produce — a physical QR code and a native camera/photo-
picker selection — and feed real payloads through the real handlers. Every
other line executed during a flow is production code.

Closes #932

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [x] Documentation update

## Acceptance Criteria

| Criterion | How it is met |
| :--- | :--- |
| An E2E harness runs against a simulator or emulator in CI | `.github/workflows/mobile-e2e.yml` builds the E2E APK and runs `e2e/run-e2e.js` on an API 27 Android emulator |
| Scan, evidence capture, offline queue, and sync-on-reconnect are covered | `e2e/flows/{scan-valid-qr,evidence-capture-queue,offline-queue,sync-on-reconnect}.yaml` |
| Airplane-mode and reconnect transitions are exercised | Harness toggles `adb` airplane mode; `offline-queue` runs offline, `sync-on-reconnect` observes connectivity returning while the app is running |
| Failures produce screenshots and logs as CI artifacts | Maestro per-flow bundles (`screenshots/`, `logs/device-logcat.txt`, `screen-hierarchy/`) + a full `logcat.txt`, uploaded always |
| Running the suite locally is documented | `app/mobile/E2E_TESTING.md`, linked from the mobile README and CONTRIBUTING |

## Files Added

- `app/mobile/e2e/run-e2e.js` — orchestration CLI: installs the APK, grants
  camera permissions, toggles airplane mode around the offline flows,
  restores connectivity mid-run for the reconnect flow, and writes
  `e2e/report.{json,md}`.
- `app/mobile/e2e/e2eAnalysis.js` — pure, device-free logic (flow order,
  airplane-mode commands, JUnit parsing, pass/fail evaluation, artifact
  classification, Markdown report). Mirrors the `coldStartAnalysis.js`
  split from #931.
- `app/mobile/e2e/mockBackend.js` — dependency-free Node HTTP backend
  implementing exactly the endpoints the flows touch (aid details, evidence
  upload sessions, claim verify/submit), so the online and reconnect flows
  complete deterministically in CI without Postgres or the on-chain adapter.
- `app/mobile/e2e/flows/scan-valid-qr.yaml`
- `app/mobile/e2e/flows/evidence-capture-queue.yaml`
- `app/mobile/e2e/flows/offline-queue.yaml`
- `app/mobile/e2e/flows/sync-on-reconnect.yaml`
- `app/mobile/e2e/__tests__/e2eAnalysis.test.js`
- `app/mobile/e2e/__tests__/mockBackend.test.js`
- `app/mobile/e2e/__tests__/runE2e.test.js`
- `app/mobile/e2e/__tests__/e2eBuildFlag.test.js`
- `app/mobile/e2e/__tests__/flows.test.js`
- `app/mobile/e2e/enable-e2e-build.js` — flips the build-time E2E switch
  for an E2E APK build (and back).
- `app/mobile/src/e2e/e2eBuildFlag.ts` — the switch itself, committed
  `false`.
- `app/mobile/src/e2e/testMode.ts` — E2E-only fixtures, gated by
  `isE2ETestModeEnabled()`.
- `app/mobile/E2E_TESTING.md`
- `.github/workflows/mobile-e2e.yml`
- `PR_DESCRIPTION_932.md` (this file)

## Files Modified

- `app/mobile/src/config/index.ts` — add `e2eEnabled` (`EXPO_PUBLIC_E2E === '1'`),
  the second switch read by `isE2ETestModeEnabled()`.
- `app/mobile/src/screens/ScannerScreen.tsx` — E2E `simulate scan` control
  that calls the real `handleBarCodeScanned`.
- `app/mobile/src/screens/EvidenceUploadScreen.tsx` — E2E `simulate capture`
  control + stable `testID`s.
- `app/mobile/src/screens/HomeScreen.tsx`, `AidDetailsScreen.tsx`,
  `SubmissionQueueScreen.tsx` — stable `testID`s for existing controls.
- `app/mobile/App.tsx` — deep-link routes for `EvidenceUpload`
  (`aid/:aidId/evidence`) and `SubmissionQueue` (`queue`), so flows can open
  those screens directly without depending on the biometric-gated aid
  details screen.
- `app/mobile/eslint.config.js` — Node globals for `e2e/**/*.js`.
- `app/mobile/package.json` — `e2e:android` script.
- `app/mobile/.env.example`, `app/mobile/README.md`,
  `app/mobile/CONTRIBUTING.md`, `README.md` — document the harness and
  `EXPO_PUBLIC_E2E`.

## Testing

- [x] Added unit tests
- [x] Ran the harness's own unit tests locally (36 passing across 5 suites)
- [ ] Full harness run on an emulator (requires Android SDK + Maestro; CI
      covers this)

The harness's pure logic and the mock backend are unit tested without a
device:

```
PASS e2e/__tests__/e2eAnalysis.test.js
PASS e2e/__tests__/e2eBuildFlag.test.js
PASS e2e/__tests__/flows.test.js
PASS e2e/__tests__/mockBackend.test.js
PASS e2e/__tests__/runE2e.test.js
Test Suites: 5 passed, 5 total
Tests:       36 passed, 36 total
```

Coverage includes: flow order and offline-before-reconnect sequencing,
airplane-mode command derivation (primary + API-27 fallback), JUnit parsing
with entity decoding and failure/error/skip classification, run evaluation
(fails on any failure, and fails when a flow produced no report), artifact
classification, report rendering, CLI argument parsing, and every mock
backend endpoint (full upload session: create → status → chunk → finalize).

The flow files are tested too, which is what keeps the CI failures below
from coming back: every flow is pinned to the app id and to a cleared start
state, every flow that uses `openLink` must wait for the app to render
first (the cold-start deep-link race), every asserted string must exist
somewhere in the app source (so a typo fails in `pnpm test` instead of
burning a 30s timeout on the emulator), and the build switch must be
committed disabled and must round-trip through
`e2e/enable-e2e-build.js`.

The mobile suite was run before and after the change to confirm no
regressions. The Sentry ESM transform failures present on `main` in this
sandbox are unchanged; the 2 new e2e suites and 27 new tests all pass.

## Code Quality Checks

- `expo lint` on every added/changed file: 0 errors (only pre-existing
  warnings unrelated to this change; `e2e/**` lints clean).
- All four Maestro flows and the workflow parse as valid YAML.
- `node --check` clean on all harness scripts.

## Behavioural Changes

- **Production builds are unchanged.** `E2E_BUILD_ENABLED` is committed
  `false` and `config.e2eEnabled` is false unless the build sets
  `EXPO_PUBLIC_E2E=1`; the simulate controls then render nothing.
- New deep-link routes: `soter://aid/:aidId/evidence` and `soter://queue`.
  These extend the existing notification deep-link targets and are useful
  outside E2E as well.
- New `pnpm e2e:android` script at `app/mobile`.

## Notes for Review

- **Why Maestro over Detox.** Maestro is flow-file based, needs no native
  test target, produces per-flow screenshot/logcat bundles for free, and
  works against a release build. That is the smallest amount of machinery
  that satisfies the artifact requirement, and it does not add a second
  Android build to CI.
- **Why test-mode seams.** No mobile E2E tool can present a QR code to an
  emulator camera or drive the native picker reliably. Rather than water
  down the scan/evidence criteria, two flag-gated controls feed real
  payloads through the real handlers. The permission *state* handling
  remains covered by the existing `CameraPermissionDenied.test.tsx` unit
  test, and the harness pre-grants camera permissions so the scanner
  mounts.
- **Why the seams are gated by a source constant.** The first CI run of
  this job failed with `id: e2e-simulate-scan is visible` on every flow —
  the app rendered the screens but none of the E2E-only controls. The cause
  was that `process.env.EXPO_PUBLIC_E2E` was not inlined into the
  Gradle-built release bundle: the expression survived as a runtime
  `process.env` lookup, which is empty in a production bundle, so
  `e2eEnabled` was `undefined` and the controls never rendered.
  `EXPO_PUBLIC_API_URL` was lost the same way. `e2eBuildFlag.ts` is a
  literal instead, so it is baked in by the same compiler pass as any other
  constant and `e2e/enable-e2e-build.js` can flip it for the E2E build.

### CI failures fixed after the first run

The first job on this branch ran all four flows and failed all four. Each
failure was reproduced from the run's uploaded artifacts (screenshots, view
hierarchies, `device-logcat.txt`) rather than guessed at:

1. **E2E controls missing from the APK** — `process.env.EXPO_PUBLIC_*` not
   inlined in the release build (above). Fixed by the build-time literal;
   the mock backend was also moved onto the app's own Android fallback port
   (3000) so a lost `EXPO_PUBLIC_API_URL` can no longer break the online
   flows, and the workflow now logs whether the URL was inlined.
2. **Deep links dropped during the cold start** — the flows opened
   `soter://…` immediately after `launchApp`, and logcat shows the `VIEW`
   intent reaching `MainActivity` ~3s *before* `ReactNativeJS: Running
   "main"`. React Native drops URL events delivered before its `Linking`
   listener exists, so the app stayed on Home. Fixed by waiting for Home to
   render before `openLink`, and pinned by `flows.test.js`.
3. **Airplane mode never actually turned on** — `adb shell cmd connectivity
   airplane-mode` exits **zero** on API 27 after printing "No shell command
   implementation.", so the fallback never ran and the setting stayed `0`
   (`could not confirm airplane mode on` in the job log). The orchestrator
   now reads `settings get global airplane_mode_on` back and applies the
   settings-write + broadcast fallback whenever the value did not change.

Two further timing fixes came out of the same run: the flows now scroll to
controls that the capture preview pushes below the fold (Maestro cannot tap
an off-screen element), and `--reconnect-delay-ms` is 60s so the reconnect
flow finishes its offline assertions before connectivity is restored.
- **E2E-only labels are not translated.** The visible text on those two
  controls lives in `src/e2e/testMode.ts` and is rendered as an expression,
  so it stays out of `src/i18n/messages` (translating a string no user can
  see is noise) while `scripts/check-i18n.mjs` still passes and remains
  honest about what is user-facing.
- **Why a mock backend.** Queueing-then-syncing has to observe a real HTTP
  200 to prove the queue actually drains. The mock server implements only
  the paths the flows call; backend contract correctness stays with the
  backend's own tests. Point the harness at a real backend with
  `--api-url`.
- **Reconnect timing.** The harness restores connectivity after
  `--reconnect-delay-ms` (default 60s), the window the flow spends queueing
  and confirming the offline state; the flow's `extendedWaitUntil`s observe
  the reconnect rather than gate it. Lower it for local iteration; CI uses
  the default.
- **Mock backend port.** The mock listens on 3000, which is the port
  `config.apiUrl` already falls back to on Android, so an online flow still
  reaches it if the build lost the inlined `EXPO_PUBLIC_API_URL`. The
  workflow logs which of the two happened.
- **Emulator profile.** API 27 / Nexus 6 / 2 vCPU / 2GB matches the
  cold-start budget job's low-end field profile. Camera hardware is left
  enabled (the scanner mounts a `CameraView`; no frames are read).

## Known Issues

- The harness cannot be executed in this sandbox (no Android SDK/KVM/
  Maestro), so the flow YAMLs are validated by parser, unit tests and
  review rather than a live run here; CI performs the live run.
- `e2e/enable-e2e-build.js` rewrites `src/e2e/e2eBuildFlag.ts` in the
  working tree. It is idempotent and reversible (`--disable`), the CI job
  is throwaway so nothing restores it there, and
  `e2e/__tests__/e2eBuildFlag.test.js` fails if the switch is ever
  committed enabled.
- The 1×1 JPEG fixture in `src/e2e/testMode.ts` is structurally valid and
  never decoded by the simulate path (the mock backend accepts any bytes);
  it only needs to be a JPEG for realism.
- The pre-existing `tsc --noEmit` errors under TypeScript 6 (DTO
  `strictPropertyInitialization`, Sentry/expo-constants type mismatches)
  are untouched; no new type errors are introduced in changed files.
