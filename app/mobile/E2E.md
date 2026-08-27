# Mobile end-to-end tests

The core field-flow suite uses [Maestro](https://maestro.mobile.dev/) to drive a real Android emulator or iOS simulator. It covers QR scanning, evidence capture, durable offline queueing, airplane-mode transitions, reconnect, and automatic sync.

## Prerequisites

- Node.js 20 and npm
- A development build of the mobile app installed on a simulator/emulator
- Maestro CLI (`curl -Ls https://get.maestro.mobile.dev | bash`)
- Android Emulator or iOS Simulator
- A test backend (or the deterministic mock API configured by the app)

Build and install the app using the normal Expo native workflow before running the suite. For Android, use an emulator with package ID `org.pulsefy.soter.mobile`; for iOS, use the configured bundle identifier.

## Run locally

```bash
cd app/mobile
npm ci
npm run e2e
```

To select a device explicitly:

```bash
npm run e2e:android
IOS_SIMULATOR="iPhone 15" npm run e2e:ios
```

Maestro toggles airplane mode during the offline portion of the flow. Android emulators must allow this operation; on iOS, run the suite on a simulator with network controls enabled by the simulator runtime.

## Diagnostics

The flow takes screenshots at each major checkpoint and on failure. The CI workflow publishes the screenshots, Maestro output, and JUnit report as the `mobile-e2e-artifacts` artifact. Locally, Maestro stores execution output under `~/.maestro/tests/`.

If the camera permission dialog appears, grant it. The scanner flow expects the simulator's deterministic QR fixture to be available; if using a physical device, point the camera at a valid Soter package QR code instead.
