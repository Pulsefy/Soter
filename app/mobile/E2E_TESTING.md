# Mobile End-to-End (E2E) Testing Guide

This guide describes how to run and maintain the automated End-to-End (E2E) test harness for the Soter mobile application (`app/mobile`), addressing **issue #932**.

The E2E test harness is built with [Maestro](https://maestro.mobile.dev/), an out-of-process, black-box testing framework that executes against the prebuilt release APK without requiring native code modifications or invasive Expo config plugins.

---

## 1. Prerequisites

### 1.1 Maestro CLI
Install the Maestro CLI on your local development machine:

* **macOS / Linux:**
  ```bash
  curl -FsSL "https://get.maestro.mobile.dev" | bash
  ```
  Ensure `~/.maestro/bin` is in your `PATH`:
  ```bash
  export PATH="$HOME/.maestro/bin:$PATH"
  ```

* **Windows:**
  Follow the official Maestro installation guide via PowerShell:
  ```powershell
  Invoke-WebRequest -Uri "https://get.maestro.mobile.dev" -OutFile install-maestro.bat; .\install-maestro.bat
  ```

Verify your installation:
```bash
maestro --version
```

### 1.2 Android Development Environment
* Android SDK (API level 27+ recommended, e.g. API 29 or 34)
* Android Emulator with Google APIs or a connected physical Android device with USB debugging enabled.
* `adb` available on your `PATH`. Verify with:
  ```bash
  adb devices
  ```

---

## 2. Building the Mobile App for E2E

The test suite runs against the standalone release APK (the same APK pattern generated in CI):

1. **Navigate to the mobile directory:**
   ```bash
   cd app/mobile
   ```

2. **Generate the native Android project via Expo Prebuild:**
   ```bash
   CI=1 npx expo prebuild --platform android
   ```

3. **Assemble the release APK:**
   ```bash
   cd android
   ./gradlew assembleRelease --no-daemon
   cd ..
   ```
   *(On Windows PowerShell, use `.\gradlew.bat assembleRelease --no-daemon`)*

4. **Install the APK onto your running emulator or device:**
   ```bash
   adb install -r android/app/build/outputs/apk/release/app-release.apk
   ```

5. **Pre-grant required permissions (optional but recommended for non-interactive test runs):**
   ```bash
   adb shell pm grant org.pulsefy.soter.mobile android.permission.CAMERA
   adb shell pm grant org.pulsefy.soter.mobile android.permission.READ_EXTERNAL_STORAGE
   adb shell pm grant org.pulsefy.soter.mobile android.permission.READ_MEDIA_IMAGES
   ```

---

## 3. Running the E2E Test Flows

Maestro test flows are located in `app/mobile/.maestro/`.

### 3.1 Run the Full Offline-First Sync Flow
The main test flow covers the complete scenario: **Scan → Evidence Capture → Offline Queue → Airplane Mode ON → Airplane Mode OFF → Sync on Reconnect**:

```bash
cd app/mobile
maestro test .maestro/offline-sync-flow.yaml
```

To run with automatic screenshot and hierarchy artifact capture:
```bash
maestro test --debug-output .maestro/debug .maestro/offline-sync-flow.yaml
```

### 3.2 Run the Scanner UI Flow
Validates the viewfinder, instructions, cancel button, and navigation to the bulk scanner:
```bash
cd app/mobile
maestro test .maestro/scanner-flow.yaml
```

### 3.3 Interactive Studio Mode
To visually inspect accessibility IDs, element hierarchies, and interactively build flows:
```bash
cd app/mobile
maestro studio
```
This opens the Maestro Studio web interface in your browser connected to the running emulator.

---

## 4. Test ID Convention

All interactive components in the app follow a kebab-case accessibility identifier naming convention:
* Buttons: `<action>-button` or `<action>-button-<id>` (e.g. `take-photo-button`, `select-photo-button`, `upload-evidence-button`, `scanner-cancel-button`, `inspect-button-${id}`)
* Tabs: `filter-tab-<category>` (e.g. `filter-tab-all`, `filter-tab-pending`, `filter-tab-failed`, `filter-tab-conflict`)
* Status/Text: `<context>-<descriptor>-text` (e.g. `offline-notice-text`, `scanner-instruction-text`)
* View containers: `<screen>-screen` or `<context>-card` (e.g. `evidence-upload-screen`, `evidence-step1-card`, `scanner-viewfinder`)

---

## 5. Continuous Integration (CI)

The CI workflow is configured in `.github/workflows/mobile-e2e.yml`. It mirrors the proven `.github/workflows/mobile-cold-start-budget.yml` pipeline:
1. Spawns an Ubuntu runner with hardware-accelerated KVM permissions.
2. Installs pnpm, Node 20, Java 17, and Android platform tools.
3. Generates the native Android project via `npx expo prebuild`.
4. Assembles the release APK (`assembleRelease`).
5. Boots an Android emulator (API 29, Nexus 6 profile).
6. Installs Maestro CLI and runs `offline-sync-flow.yaml`.
7. Uploads failure screenshots, device logcat, and UI hierarchy dumps as artifacts using `actions/upload-artifact@v4`.

---

## 6. Troubleshooting

* **Airplane mode command fails on physical devices:**  
  On non-rooted physical devices running newer Android versions, toggling airplane mode via ADB may require `adb shell cmd connectivity airplane-mode enable` or manual toggling via Quick Settings. Emulators on CI and local development support standard toggling via Maestro's `setAirplaneMode: true/false`.
* **Emulator camera feed is black:**  
  Headless emulators run with `-camera-back none`. Barcode scanning routes are validated via deep linking (`openLink: "soter://package/<aidId>"`), matching the URL parser behavior in `ScannerScreen.tsx`.
* **Test times out waiting for reconnect:**  
  Ensure your host network allows internet connectivity to the Android emulator. If testing without a live backend server, the queue will transition from pending to retry state, which is considered a successful sync dispatch attempt.
