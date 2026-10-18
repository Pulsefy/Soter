# Cold Start Performance Budget (issue #931)

Nothing previously measured how long the app takes to become usable from a
cold start. Field devices are typically low-end Android hardware, so a
regression that adds a couple of seconds to startup on a development
machine (fast CPU, warm caches, plugged in) can be invisible to the team
that shipped it and still very visible to a field worker on a 2GB-RAM
phone. This is the fix: a measured, budgeted, phase-attributed cold-start
number that CI enforces on a representative low-end profile.

## What "cold start to interactive" means here

**Cold start**: the app process does not already exist — `adb shell am
force-stop` before every measurement, matching a user tapping the icon
after a reboot or after Android has killed the app in the background
(routine on low-RAM devices).

**Interactive**: the point at which `NavigationContainer`'s `onReady`
fires — the initial screen has mounted and is navigable. This is an
existing signal in `App.tsx` (`onReady={() => setIsNavReady(true)}`), not
something new added for this measurement.

## How it's measured

1. `src/startup/coldStartTracker.ts` records a wall-clock timestamp
   (`Date.now()`) at three points in the JS startup sequence and logs each
   one as `[ColdStart] <phase> <epochMs>`:
   - `jsStart` — the first line executed in `index.ts`, before any other
     import.
   - `appRenderStart` — the root `App()` component body starts executing.
   - `navigationReady` — `NavigationContainer.onReady` fires.
2. `scripts/measure-cold-start.js` drives a connected device/emulator
   through N cold starts (`adb shell am force-stop` → `adb logcat -c` →
   `adb shell am start -W` → poll `adb logcat -d` for the three phase
   lines), and for each iteration computes:

   | Phase | Duration |
   | :--- | :--- |
   | Native process launch → JS start | `jsStart - <launch invoked>` |
   | JS start → app render start | `appRenderStart - jsStart` |
   | App render start → interactive | `navigationReady - appRenderStart` |
   | **Total: launch → interactive** | `navigationReady - <launch invoked>` |

   A device-vs-host clock offset is sampled once per iteration
   (`adb shell date +%s%3N`) and applied before computing durations, so
   the numbers are correct even when the emulator/device clock has
   drifted from the CI runner's clock.
3. The median (not mean — deliberately outlier-resistant) total across
   iterations is compared against `perf/cold-start-budget.json`. The pure
   parsing/aggregation/budget-comparison logic lives in
   `scripts/coldStartAnalysis.js`, unit tested in
   `scripts/__tests__/coldStartAnalysis.test.js` independently of any real
   device.
4. A JSON + Markdown report is written to `perf/cold-start-report.{json,md}`.

## The budget

`perf/cold-start-budget.json`:

```json
{
  "totalMs": 3500,
  "toleranceRatio": 0.15,
  "iterations": 5
}
```

The gate: **fail if the median total exceeds `totalMs * (1 + toleranceRatio)`**
(currently 4025ms). The tolerance absorbs normal emulator-to-emulator
variance between CI runs; it is not there to hide real regressions.

`phaseBudgetsMs` in the same file are **informational**, not a hard gate —
they help attribute *which* phase grew when the total budget check fails,
without three separate pass/fail conditions to reason about.

The initial `totalMs` is a conservative starting estimate (see
`calibrationNote` in the file), not yet calibrated against a real run of
this specific app on this specific CI profile. Recalibrate it from the
first several real `cold-start-report.json` runs on `main`, then update
`lastCalibrated`. Recalibrating means picking a new `totalMs` from
observed good measurements — never loosen the number just to make a
regression pass.

## Device profile

CI measures on an Android API 27 (8.1) x86_64 emulator using the "Nexus 6"
AVD hardware profile, explicitly constrained to 2 vCPUs and 2048MB RAM
(`.github/workflows/mobile-cold-start-budget.yml`) — chosen to represent
the low end of field devices, not development hardware. An emulator is
not a perfect stand-in for a real device (no thermal throttling, storage
I/O is faster), but it is deterministic, free, and available in CI, which
running on physical hardware in CI is not. Treat regressions caught here
as real; treat the absolute number as directional rather than a promise
of real-device performance.

## Running it locally

Requires the Android SDK, a running emulator or a connected device with
USB debugging enabled, and `adb` on your `PATH`.

```bash
cd app/mobile
npm ci

# Build a release APK (a debug APK expects a live Metro server and won't
# work for this — see the CI workflow's signing note for why release
# signing falls back to the debug keystore for measurement purposes).
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease && cd ..
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Run the measurement (defaults: 5 iterations, reads
# perf/cold-start-budget.json, package id from app.json).
npm run measure:cold-start

# Or with explicit options, e.g. targeting one of several connected devices:
node scripts/measure-cold-start.js --device emulator-5554 --iterations 10
```

Exit code is non-zero when the median exceeds budget, matching CI. See
`node scripts/measure-cold-start.js --help`-equivalent usage in the
script's header comment for every flag.

To run just the unit tests for the measurement logic (no device needed):

```bash
npx jest scripts/__tests__ src/__tests__/coldStartTracker.test.ts
```

## Adding to or changing the tracked phases

If you add a fourth phase, update all three of these together:
`src/startup/coldStartTracker.ts` (the `ColdStartPhase` union and the
marker call site), `scripts/coldStartAnalysis.js` (`PHASE_ORDER` and the
duration computation), and this document's phase table. The log tag
(`[ColdStart]`) and phase names are a parsed wire format — renaming either
without updating the analysis script silently breaks measurement (every
run reports every phase "missing").
