# End-to-End Test Harness for Core Field Flows (issue #932)

`src/__tests__/` holds unit tests, but nothing previously drove the app as
a user. The critical field flows — scan, capture evidence, queue offline,
sync when connectivity returns — span screens, native permissions, and
persistence, which is exactly what unit tests cannot cover. This document
describes the end-to-end harness that closes that gap, what it covers, and
how to run it locally and in CI.

## What it covers

| Flow | File | Connectivity | What it exercises |
| :--- | :--- | :--- | :--- |
| Scan | `e2e/flows/scan-valid-qr.yaml` | online | Home → Scanner, camera-permission state, QR parse + de-dup, navigation to aid details |
| Evidence capture | `e2e/flows/evidence-capture-queue.yaml` | online | Evidence screen, capture pipeline, inline upload, success state |
| Offline queue | `e2e/flows/offline-queue.yaml` | offline | Offline detection, upload queued to `AsyncStorage`, visible in Submission Queue |
| Sync on reconnect | `e2e/flows/sync-on-reconnect.yaml` | offline → online | NetInfo transition, `flushPendingNetworkActions`, queue drains with no user action |

`e2e/e2eAnalysis.js` also pins the flow order and the offline-before-
reconnect sequencing in unit tests, so the suite cannot silently stop
covering the transition.

## How it works

Three pieces, deliberately separated so as much as possible is testable
without an emulator (the same split used by the cold-start tooling in
`COLD_START_BUDGET.md`):

1. **Maestro flows** (`e2e/flows/*.yaml`) — declarative user journeys run
   against the installed app. Maestro writes a JUnit report plus a
   per-flow artifact bundle (step screenshots, `logs/device-logcat.txt`,
   view hierarchies) that the harness copies into CI artifacts.
2. **Orchestration** (`e2e/run-e2e.js`) — installs the APK, grants camera
   permissions, toggles airplane mode around the offline flows via `adb`,
   restores connectivity mid-run for the reconnect flow, then aggregates
   results into `e2e/report.{json,md}`. Its pure logic lives in
   `e2e/e2eAnalysis.js` and is unit tested in `e2e/__tests__/`.
3. **Mock backend** (`e2e/mockBackend.js`) — a dependency-free Node HTTP
   server implementing exactly the endpoints the flows touch (aid details,
   evidence upload sessions, claim verify/submit). It lets the online and
   reconnect flows complete deterministically in CI without standing up
   the NestJS service, Postgres, and the on-chain adapter. Point the
   harness at a real backend with `--api-url` when you want to.

### Test-mode seams

A headless emulator cannot produce a physical QR code for the camera or
drive the native camera/photo picker. Rather than skip scanning and
evidence capture, the harness builds the app with the E2E build switch
flipped, which makes two deterministic controls visible:

- `ScannerScreen` — `e2e-simulate-scan` feeds a real
  `soter://package/E2E-AID-1` payload through the same
  `handleBarCodeScanned` handler a camera hit would (parse, de-dup,
  navigate).
- `EvidenceUploadScreen` — `e2e-simulate-capture` feeds a bundled 1×1 JPEG
  through the real compression/upload pipeline.

Both are gated by `isE2ETestModeEnabled()`, which reads two switches, and
render nothing in any other build, so production behaviour is unchanged.
Everything after those two inputs — queueing, persistence, sync, HTTP, the
UI states — is the real app code.

- `src/e2e/e2eBuildFlag.ts` — a literal, committed as `false`, that
  `e2e/enable-e2e-build.js` flips to `true` for an E2E build. This is the
  switch CI and local release builds use. It is a source constant rather
  than an environment variable on purpose: `process.env.EXPO_PUBLIC_*` is
  inlined by Babel at bundle time, and when that inlining does not happen
  for a Gradle-built release APK the expression survives as a runtime
  lookup that resolves to `undefined` — the controls silently vanish and
  the suite fails against an app that looks correct but cannot be driven.
- `config.e2eEnabled` (`EXPO_PUBLIC_E2E=1`) — kept for development builds
  started through `expo start`/`expo run:android`, where the dev server
  supplies the variable at runtime.

## Running it locally

Prerequisites:

- The Android SDK with a running emulator or a USB-debugging device and
  `adb` on `PATH`.
- The [Maestro CLI](https://docs.maestro.dev/getting-started/installing-maestro)
  (`curl -Ls "https://get.maestro.mobile.dev" | bash`).
- Node 20+ (the harness itself is dependency-free).

```bash
cd app/mobile
pnpm install

# 1. Flip the build-time switch that reveals the E2E-only controls. It is
#    committed disabled so production builds can never ship them; the CI
#    build flips it itself (see .github/workflows/mobile-e2e.yml).
node e2e/enable-e2e-build.js

# 2. Build an E2E release APK. The harness serves its mock backend on port
#    3000 by default, which is already the Android fallback baked into
#    config.apiUrl, so no EXPO_PUBLIC_API_URL is needed. The emulator
#    reaches the host at 10.0.2.2.
EXPO_PUBLIC_ENV_NAME=e2e npx expo prebuild --platform android
cd android && ./gradlew assembleRelease --no-daemon && cd ..

# 3. Run the suite. `run-e2e.js` starts the mock backend, installs the APK,
#    grants camera permissions, and drives the flows.
pnpm e2e:android

# Or run a single flow while iterating (still installs/starts everything):
node e2e/run-e2e.js --flow scan-valid-qr
node e2e/run-e2e.js --flow sync-on-reconnect --reconnect-delay-ms 20000

# 4. Put the switch back before committing.
node e2e/enable-e2e-build.js --disable
```

Useful flags (see the header of `e2e/run-e2e.js` for the full list):

| Flag | Purpose |
| :--- | :--- |
| `--device <serial>` | Target a specific emulator/device |
| `--apk <path>` | Install a different build |
| `--no-install` | Use the already-installed app |
| `--skip-network` | Do not take the device offline (it stays as-is) |
| `--api-url <url>` | Skip the mock backend and target a real API |
| `--flow <id>` | Run one flow (repeatable) |
| `--out <dir>` | Artifact directory (default `e2e/artifacts`) |

To run just the harness's own unit tests (no device needed):

```bash
pnpm test -- e2e/__tests__ 
```

## Taking the device offline, and the reconnect transition

Connectivity is toggled with `adb`, not from inside the app, so the flows
exercise the real NetInfo path:

- `offline-queue` runs **offline**; the app queues the upload to
  `AsyncStorage` instead of attempting it.
- `sync-on-reconnect` starts **offline**, queues an upload, and confirms
  the offline state. The harness then waits `--reconnect-delay-ms`
  (default 120s — the window the flow spends cold-starting, queueing and
  asserting) and restores connectivity. `useNetworkStatus` observes the
  transition and `flushPendingNetworkActions` drains the queue against the
  mock backend, asserted by `extendedWaitUntil` on the queue's empty
  state.

`airplaneModeCommands` in `e2e/e2eAnalysis.js` produces the `adb` argument
lists. Three things about them are load-bearing:

1. **`cmd connectivity airplane-mode` is version-specific.** It exists from
   API 30; on the CI profile (API 27) it exits **zero** after printing
   "No shell command implementation.", so its exit code means nothing.
2. **The `AIRPLANE_MODE` broadcast cannot be sent from the shell.** It is a
   protected broadcast, so `am broadcast -a
   android.intent.action.AIRPLANE_MODE` fails with
   `Permission Denial: not allowed to send broadcast … from uid=2000` and
   leaves the radio up.
3. **The fallback therefore has to move the radios, not the setting.**
   `svc wifi disable` + `svc data disable` tear down the two transports
   that carry traffic on an emulator; `svc wifi enable` + `svc data enable`
   bring them back. `settings put global airplane_mode_on` is still written
   so the status-bar indicator is honest.

The orchestrator applies **all** of those commands on every toggle instead
of deciding from a read-back whether to fall back. `airplane_mode_on` reads
`1` after the settings write even when the radio never dropped, so gating on
it is a false confirmation — the trap the first CI run fell into, where the
offline flows ran against a connected device (`isConnected` stayed true) and
failed waiting for offline copy that never rendered. The commands are
idempotent, so running them all is safe; the read-back is only used to log
what the device reports.

## Taps near the bottom of the screen

The app draws edge-to-edge, so a form can be scrolled until its last button
is "fully inside the viewport" while it still sits **behind** the system
navigation bar. On the CI emulator that bar owns x 580-860 / y 2392-2560
(the home button), so `tapOn` at the element's centre coordinates lands on
Home: the app is backgrounded and the assertion that follows times out on a
screenshot of the launcher. Maestro's default stop condition for
`scrollUntilVisible` (`visibilityPercentage: 100`) is satisfied inside that
strip, and *where* the swipe sequence happens to stop decides the outcome —
which is why `offline-queue` passed one run and failed the next with no code
change between them.

Every `scrollUntilVisible` that finds a control to tap therefore sets
`centerElement: true`, so the scroll keeps going until the element is clear
of the bar (it gives up after a few attempts instead of hanging when the
form cannot scroll any further).
`e2e/__tests__/flows.test.js` fails if a flow taps
`upload-evidence-button` without centering it first. The same trap applies
to any new flow that taps a control near the bottom of a form.

## Failures → CI artifacts

The workflow (`.github/workflows/mobile-e2e.yml`) uploads, always:

- `mobile-e2e-report` — `e2e/report.json` and `e2e/report.md`, with the
  per-flow pass/fail and the failing case names.
- `mobile-e2e-artifacts` — per-flow Maestro bundles:
  `screenshots/` (Maestro captures the failing step automatically),
  `logs/device-logcat.txt` (plus `crash-report.txt` / `anr-report.txt`
  when present), `screen-hierarchy/`, and a full `logcat.txt` dump the
  harness takes after each flow.

On a green run the screenshot folders are usually empty by design —
Maestro only writes a screenshot for a failing step. Request explicit ones
with `takeScreenshot` inside a flow if you need them on success.

## CI

`.github/workflows/mobile-e2e.yml` builds the E2E APK once, then runs the
suite on an Android API 27 x86_64 emulator (a low-end field profile, the
same as the cold-start budget). It needs hardware acceleration, so the KVM
group perms step is required. A non-zero exit from `run-e2e.js` fails the
job.

## Limitations

- **Camera and picker hardware are simulated.** The two E2E-only controls
  feed real payloads through the real handlers, but the OS camera preview
  and photo picker themselves are not automated (no mobile E2E tool can
  reliably do this on a headless emulator). Camera-permission *state*
  handling is covered by the flow waiting through it and by the unit tests
  in `src/__tests__/CameraPermissionDenied.test.tsx`.
- **The mock backend is a stand-in**, not a contract guarantee. Response
  shapes it serves must match the clients; if a client route changes,
  update `e2e/mockBackend.js` in the same change. Backend contract
  correctness is covered separately by the backend's own tests.
- **An emulator is not a field device** (no thermal throttling, different
  storage/network behaviour). Treat failures as real; treat timing as
  directional.

## Adding a flow

1. Add `e2e/flows/<name>.yaml` with `appId: org.pulsefy.soter.mobile` and
   `launchApp: { clearState: true }`.
2. Register it in `FLOW_ORDER` in `e2e/e2eAnalysis.js` with the
   connectivity it needs (`online`, `offline`, or `reconnect`).
3. Prefer existing `testID`s and accessibility labels over literal text;
   add a `testID` to the screen if a stable handle is missing.
   The three pitfalls `e2e/__tests__/flows.test.js` guards against are worth
   knowing up front:
   - **Never `openLink` during the cold start.** Android hands the intent
     to `MainActivity` even while the JS runtime is still booting, and
     React Native drops URL events that arrive before its `Linking`
     listener exists — the app just stays on Home. Wait for the first
     screen (e.g. `id: "scan-fab"`) before opening a link.
   - **Only assert copy the app really renders.** A typo makes the flow
     burn its whole timeout and fail with an opaque "assertion is false".
     The test resolves each asserted string against the app source, so a
     string the app does not contain fails fast in `pnpm test`.
   - **Never tap a control that is still behind the navigation bar.**
     Scrolling until it is "fully visible" is not enough on this
     edge-to-edge layout — the tap hits the system home button instead.
     Scroll with `centerElement: true` (see "Taps near the bottom of the
     screen" above).
4. If the flow needs a new backend endpoint, add it to
   `e2e/mockBackend.js` and cover it in
   `e2e/__tests__/mockBackend.test.js`.
5. Update the coverage table above and `e2e/__tests__/e2eAnalysis.test.js`
   if the flow order or network stages change.
