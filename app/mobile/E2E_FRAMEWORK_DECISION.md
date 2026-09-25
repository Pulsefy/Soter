# Mobile E2E Test Framework Decision: Detox vs. Maestro

**Issue:** #932 — Mobile E2E Test Harness  
**Target Application:** `app/mobile` (Soter Mobile)  
**Stack Context:** Expo SDK 54 (expo `~54.0.37`), React Native `0.81.5`, React 19 (`19.1.0`), New Architecture enabled (`"newArchEnabled": true`), Android Gradle build pipeline via `expo prebuild`.

---

## 1. Executive Summary

This document evaluates end-to-end (E2E) testing framework options for the Soter mobile application (`app/mobile`). The primary contenders evaluated are **Detox** (Wix) and **Maestro** (mobile.dev), with secondary consideration given to **Appium**.

The test harness must validate mission-critical offline-first flows:
1. QR Code / Aid scanning (`ScannerScreen`, `BulkScannerScreen`)
2. Evidence photo capture and compression (`EvidenceUploadScreen`)
3. Offline queue persistence (`SubmissionQueueScreen`, `syncQueue.ts`)
4. Hardware network disconnection (real device-level Airplane mode)
5. Reconnection and automated queue synchronization on reconnect

### Final Recommendation Summary
**Maestro is unequivocally recommended over Detox.** Maestro is an out-of-process, black-box testing framework driven by UIAutomator and ADB that operates directly on the standalone release APK (`app-release.apk`) already generated in CI by `expo prebuild` + `./gradlew assembleRelease`. It introduces **zero native code churn**, avoids fragile Expo config plugins, natively handles system dialogs (camera/media permissions and system photo pickers), natively controls device connectivity, and seamlessly drops into the existing GitHub Actions emulator workflow without requiring secondary test APK compilation.

---

## 2. Technical Context & Constraints

The evaluation is grounded in the existing repository architecture:
* **Expo-Managed Workflow:** `app/mobile` does not check in native `android/` or `ios/` folders. Native projects are generated ephemerally via `CI=1 npx expo prebuild --platform android`.
* **Modern Runtime:** React Native `0.81.5`, React `19.1.0`, Expo SDK `54.0.37`. Crucially, `app.json` configures `"newArchEnabled": true`, running the New Architecture (Fabric renderer and Bridgeless mode).
* **CI Precedent (`.github/workflows/mobile-cold-start-budget.yml`):**
  * Ubuntu runner with KVM acceleration enabled (`/etc/udev/rules.d/99-kvm4all.rules`).
  * Node 20, Java 17 (Temurin), Android SDK v4 platform tools.
  * Headless emulator runner (`reactivecircus/android-emulator-runner@v2`) running API level 27 (or higher).
  * Single APK build step: `./gradlew assembleRelease --no-daemon` with debug signing fallback.
* **Offline-First Sync Core:** `syncQueue.ts`, `SyncContext.tsx`, and `SyncDeferralContext.tsx` rely on `@react-native-async-storage/async-storage` and `@react-native-community/netinfo` to transition states (`pending` -> `retrying` / `failed` / `completed`) based on actual network responses.

---

## 3. Detailed Comparative Evaluation

### Criterion 1: Native Config Overhead & Expo Managed Compatibility

| Aspect | Detox | Maestro |
| :--- | :--- | :--- |
| **Architectural Model** | In-process, grey-box instrumentation (Espresso on Android). | Out-of-process, black-box instrumentation (UIAutomator / Accessibility). |
| **Native Changes Needed** | Heavy: requires custom Android test runner (`DetoxTest.java`), Gradle dependencies (`com.wix:detox:+`), `testInstrumentationRunner`, ProGuard rules, network security config. | **Zero:** operates externally against standard production or release binaries. |
| **Expo Managed Workflow** | Requires `@config-plugins/detox` or maintaining custom Gradle build scripts injected during prebuild. Config plugins frequently break across major Expo SDK / React Native upgrades. | **100% clean:** No config plugins, no native modules, no changes to `app.json` or `package.json` native dependencies. |
| **New Architecture (Fabric/Bridgeless)** | Known synchronization and idling resource issues with RN New Architecture and React 19 concurrent features. | Completely agnostic to JS runtime and New Architecture since it queries OS-level accessibility trees. |
| **Compilation Artifacts** | Requires compiling **two** APKs: `app-release.apk` AND `app-release-androidTest.apk` via `./gradlew assembleRelease assembleAndroidTest`. | Reuses the single existing `app-release.apk`. |

**Analysis:** Detox requires intrusive native modifications. In an Expo-managed app where `android/` is ephemeral, Detox relies on third-party config plugins to modify Gradle files during `expo prebuild`. If the plugin falls out of sync with Expo SDK 54 or React Native 0.81's Gradle 8.x configuration, CI breaks. In contrast, Maestro requires zero native changes.

---

### Criterion 2: Device-Level Airplane Mode & Network Control in CI

The test scenario requires testing: **Scan / Evidence Capture → Offline Queue → Airplane Mode ON → Airplane Mode OFF → Sync on Reconnect**.

| Control Mechanism | Detox | Maestro |
| :--- | :--- | :--- |
| **In-Test Control** | Detox runs within Node.js and executes Espresso inside the app. It has no native device-level airplane mode API. It supports URL blacklisting, which only mocks network requests at the OkHttp level rather than triggering OS-level network state transitions. | Maestro provides direct built-in commands: `setAirplaneMode: true` and `setAirplaneMode: false`. |
| **OS-Level NetInfo Trigger** | Mocking HTTP does not trigger NetInfo listener updates in `@react-native-community/netinfo`. `SyncContext` relies on `NetInfo` to detect reconnection (`handleReconnect`). Triggering real net changes in Detox requires escaping to Node child process `execSync("adb shell ...")`. | `setAirplaneMode: true` toggles the Android system setting, immediately notifying `NetInfo` and changing network reachability across the entire OS. |
| **Execution via ADB** | `adb shell cmd connectivity airplane-mode enable`<br>`adb shell cmd connectivity airplane-mode disable` *(or `adb shell svc wifi disable && adb shell svc data disable`)* | Maestro can execute shell commands directly or run built-in `setAirplaneMode`. In CI, ADB can also run external commands synchronously between flow assertions. |
| **Detox Synchronization Risk** | When the network is cut, Detox's idling resources can hang waiting for network requests to complete, leading to test timeouts unless synchronization is explicitly disabled. | Maestro does not hook into OkHttp idling resources; it asserts against UI states and accessibility nodes with explicit timeouts. |

**Analysis:** Real device-level offline testing demands genuine OS network disconnection so that NetInfo triggers `handleReconnect` and flushes `syncQueue`. Maestro provides native `setAirplaneMode` commands out of the box and does not suffer from Espresso idling lockups when connections drop.

---

### Criterion 3: Camera Permission & Emulator Hardware Emulation

The flows in scope are:
1. QR scanning via `expo-camera` (`CameraView`) in `ScannerScreen` / `BulkScannerScreen`.
2. Evidence photo capture via `expo-image-picker` (`launchCameraAsync` or `launchImageLibraryAsync`) in `EvidenceUploadScreen`.

| Challenge | Detox Handling | Maestro Handling |
| :--- | :--- | :--- |
| **System Permission Dialogs** | Detox is bound to the target app's instrumentation process. It cannot easily click Android OS system permission popups ("Allow Soter to take pictures and record video?"). Permissions must be pre-granted via `device.launchApp({ permissions: { camera: 'YES' } })` or ADB. | Maestro operates at the OS level (UIAutomator). It can either pre-grant permissions via ADB (`adb shell pm grant ...`) **or** interact directly with native OS permission dialogs (`tapOn: "While using the app"`). |
| **Camera View in Emulator** | The emulator has no physical camera. Headless emulators with `-camera-back none` render a blank/black feed. `CameraView` barcode detection cannot scan physical barcodes unless a virtual scene with test QR codes is configured. | Same emulator camera constraint, but Maestro provides alternative verified test paths (e.g. system gallery selection or deep link navigation). |
| **Evidence Photo Selection** | `EvidenceUploadScreen.tsx` provides both `takePhoto` (camera) and `pickImage` (`ImagePicker.launchImageLibraryAsync` - photo library). When photo library is opened, a system file picker / gallery activity appears. Detox **cannot** automate native system file pickers outside the app process. | Maestro seamlessly automates system picker activities: it can click through the Android system gallery, select pre-seeded test images, or interact with any system intent. |
| **Pre-seeding Test Assets** | Handled in CI runner before test: `adb push test-evidence.jpg /sdcard/Pictures/` followed by media scan intent. | Same: assets can be pushed via ADB before flow execution, then selected via Maestro flow. |
| **Deep Link QR Bypass** | `ScannerScreen.tsx` parses standard deep links: `soter://package/<aidId>`. If camera QR scanning in headless emulator is physically bypassed, deep link invocation directly tests the same routing. | Maestro has built-in `openLink: "soter://package/AID-TEST-123"` to test navigation verification seamlessly. |

**Analysis:** Detox's in-process Espresso limitation makes it incapable of interacting with Android's system image picker dialogs when `ImagePicker.launchImageLibraryAsync()` opens. Maestro operates via UIAutomator, allowing full end-to-end automation of photo selection from the system gallery and handling system permission dialogs gracefully.

---

### Criterion 4: Integration with Existing CI Precedent (`mobile-cold-start-budget.yml`)

The existing CI workflow (`mobile-cold-start-budget.yml`) has already solved several complex Android emulator problems in GitHub Actions:
- KVM permissions on Linux runners (`/dev/kvm`).
- Android SDK v4 setup without deprecated SDK packages.
- Sentry build task bypasses (`SENTRY_DISABLE_AUTO_UPLOAD=true`).
- Expo prebuild + `./gradlew assembleRelease` generating an installable release APK.
- Running headless emulator via `reactivecircus/android-emulator-runner@v2`.

| Pipeline Aspect | Detox | Maestro |
| :--- | :--- | :--- |
| **Build Step Reusability** | **Incompatible with existing step.** Requires a new Gradle target: `./gradlew assembleRelease assembleAndroidTest`. Must build two separate APKs. | **100% Reusable.** Tests directly against the existing `android/app/build/outputs/apk/release/app-release.apk`. No build script changes needed. |
| **CI Tooling Footprint** | Requires Node.js Detox CLI, `.detoxrc.js`, Jest runner, and compilation of test runner APK. Adds 5–10 minutes to CI build time. | Requires installing the standalone Maestro CLI (single binary download: `curl -FsSL https://get.maestro.mobile.dev \| bash`). Adds ~10 seconds. |
| **Emulator Runner Integration** | Must configure Detox to connect to the running emulator ID via ADB or Detox server web socket. | Runs directly in the `android-emulator-runner` script block: `maestro test flows/mobile-e2e.yaml`. |
| **Execution Speed** | Slower startup; requires WebSocket handshake and instrumentation handshake between test runner and app. | Fast startup; executes commands immediately via ADB / UIAutomator. |

**Analysis:** Maestro drops directly into the exact workflow pattern already proven in `mobile-cold-start-budget.yml`. It reuses the exact release build step, installs the APK via `adb install`, and runs the test suite in seconds without extra Gradle build overhead.

---

### Criterion 5: Failure Artifact Capture (Screenshots, Logs, Dumps)

| Feature | Detox | Maestro |
| :--- | :--- | :--- |
| **Automatic Screenshots on Failure** | Supported via `.detoxrc.js` (`artifacts: { onFails: { takeScreenshots: true } }`), but requires custom path configuration. | **Built-in:** `maestro test --debug-output <dir>` automatically captures full-resolution screenshots at the exact point of failure. |
| **Logcat & Device Logs** | Requires custom scripting or Detox artifact plugins; often mixes JS logs with verbose Android system logs. | Automatically captures device logs, test run timeline, and hierarchy inspection trees in the debug output directory. |
| **View Hierarchy Dump** | Difficult to extract on failure; requires custom Jest reporters. | Automatically captures an interactive XML/JSON accessibility hierarchy dump on failure for immediate triage. |
| **GitHub Actions Upload Artifacts** | Requires manual wiring of output folder to `actions/upload-artifact@v4`. | Directly compatible: single folder upload targeting `app/mobile/.maestro/debug` or specified `--debug-output` path. |

**Analysis:** Maestro's `--debug-output` option automatically produces screenshots, logcat logs, and UI hierarchy snapshots on test failure with zero custom JavaScript plumbing.

---

## 4. Evaluation Matrix

| Criterion | Weight | Detox | Maestro | Appium |
| :--- | :---: | :---: | :---: | :---: |
| **Expo Managed Compatibility** | High | 2/5 (fragile config plugin) | **5/5 (zero native footprint)** | 4/5 (black-box) |
| **React Native New Arch / React 19** | High | 2/5 (known sync issues) | **5/5 (OS accessibility based)** | 4/5 (black-box) |
| **Airplane Mode / Device Control** | High | 2/5 (no native API, hangs sync) | **5/5 (native `setAirplaneMode`)** | 3/5 (custom ADB driver) |
| **System Dialogs (Camera / Files)** | High | 1/5 (cannot leave app process) | **5/5 (full UIAutomator control)** | 4/5 (supports system) |
| **Reuse of Existing CI Precedent** | High | 2/5 (needs test APK & new Gradle step) | **5/5 (reuses existing release APK)** | 3/5 (requires Appium server setup) |
| **Artifact Capture on Failure** | Medium | 3/5 (requires custom setup) | **5/5 (built-in `--debug-output`)** | 3/5 (custom reporter needed) |
| **Maintenance Burden** | Medium | 2/5 (version lock-in with RN) | **5/5 (declarative YAML flows)** | 2/5 (heavy client/server deps) |
| **TOTAL** | | **14 / 35** | **35 / 35** | **23 / 35** |

---

## 5. Final Recommendation & Justification

### One-Paragraph Justification
**We recommend Maestro as the E2E testing framework for Soter Mobile.** Maestro is an out-of-process, black-box testing framework that operates directly against the prebuilt release APK (`app-release.apk`) generated by Expo's standard build pipeline, eliminating the native configuration overhead, Gradle instrumentation dependencies, and React Native New Architecture compatibility hazards inherent to Detox. Because Maestro controls the device through Android's accessibility and UIAutomator layers, it natively supports real device-level airplane-mode toggling, can interact seamlessly with OS-level permission dialogs and system photo pickers for evidence capture, requires no secondary test APK compilation, and integrates directly into the existing `mobile-cold-start-budget.yml` CI pattern while providing automated failure screenshots and hierarchy logs.

---

## 6. Implementation Plan for Phase 2 (Pending Approval)

Upon explicit approval of this decision:
1. **Screen Accessibility IDs (`testID`):**
   - In `ScannerScreen.tsx`: Add consistent test IDs: `scanner-viewfinder`, `scanner-cancel-button`, `scanner-bulk-mode-button`, `scanner-rescan-button`.
   - In `EvidenceUploadScreen.tsx`: Add consistent test IDs following the `SubmissionQueueScreen.tsx` kebab-case convention (`take-photo-button`, `select-photo-button`, `upload-evidence-button`, `choose-again-button`, `retry-upload-button`).
2. **Maestro Test Flows (`app/mobile/.maestro/`):**
   - Create `offline-sync-flow.yaml` testing the end-to-end user journey:
     - Navigate to Scanner / Aid Details.
     - Select and compress evidence photo.
     - Queue upload in offline state (`setAirplaneMode: true`).
     - Verify item appears in `SubmissionQueueScreen` with pending status.
     - Restore network (`setAirplaneMode: false`).
     - Trigger / observe automated sync and confirmation.
3. **CI Workflow (`.github/workflows/mobile-e2e.yml`):**
   - Replicate the proven emulator, KVM, Node, Java 17, and `./gradlew assembleRelease` steps from `mobile-cold-start-budget.yml`.
   - Install Maestro via official CLI action/installer.
   - Run `maestro test --debug-output app/mobile/.maestro/debug app/mobile/.maestro/offline-sync-flow.yaml`.
   - Wire `actions/upload-artifact@v4` with `if: always()` to capture screenshots and logs on failure.
4. **Documentation (`app/mobile/E2E_TESTING.md`):**
   - Provide local prerequisites (Maestro CLI, Android emulator / physical device).
   - Document commands to run flows locally and inspect artifacts.
