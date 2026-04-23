# Soter Mobile 📱

Mobile application for field operations and pilots, built with Expo and TypeScript.

## Features

- **Home Screen**: Overview and quick actions.
- **Health Screen**: Real-time system status monitoring with environment indicator.
- **Navigation**: Built with React Navigation.
- **Environment Support**: Uses `EXPO_PUBLIC_*` for configuration.

## Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Update `EXPO_PUBLIC_API_URL` to point to your backend.

3. **Start the app**:
   ```bash
   pnpm start
   ```

## Environment Variables

All Expo public variables are prefixed with `EXPO_PUBLIC_` and are safe to ship in any build — they contain no secrets.

| Variable | Required | Default | Description |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | Yes | `http://localhost:3000` | Full URL of the backend API. Used by the Health Screen and the API service. |
| `EXPO_PUBLIC_ENV_NAME` | No | auto-inferred | Human-readable label shown in the Health Screen badge and footer (e.g. `dev`, `staging`, `prod`). |
| `EXPO_PUBLIC_NETWORK` | No | `testnet` | Blockchain network identifier. |
| `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes for wallet connect | none | WalletConnect v2 project id used by the mobile wallet pairing flow. |
| `EXPO_PUBLIC_WALLETCONNECT_STELLAR_CHAIN_ID` | No | inferred from `EXPO_PUBLIC_NETWORK` | Optional CAIP-2 override for the Stellar WalletConnect chain id. |

### `EXPO_PUBLIC_API_URL`

```bash
# Local development (iOS Simulator)
EXPO_PUBLIC_API_URL=http://localhost:3000

# Local development (Android Emulator)
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000

# Physical device – use your machine's LAN IP
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000

# Staging / production
EXPO_PUBLIC_API_URL=https://api.staging.example.com
```

### `EXPO_PUBLIC_ENV_NAME` (optional)

Sets the coloured environment badge visible in the Health Screen header and footer.
If omitted, the label is **auto-inferred** from `EXPO_PUBLIC_API_URL`:

| URL contains | Inferred label | Badge colour |
|---|---|---|
| `prod` | `prod` | 🔴 red |
| `staging` | `staging` | 🟠 amber |
| anything else | `dev` | 🔵 blue |

```bash
EXPO_PUBLIC_ENV_NAME=dev      # or staging, prod, or any custom name
```

> The badge and footer text are always visible (there are no secrets) so they are safe to leave in production builds.

### WalletConnect setup

The Home Screen now includes a `Connect Wallet` action for mobile Stellar wallets.

1. Create a WalletConnect project at `https://dashboard.walletconnect.com`.
2. Set `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` in `.env`.
3. Build a development client or production build so the custom `soter://` scheme is registered on the device.

```bash
EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
EXPO_PUBLIC_WALLETCONNECT_STELLAR_CHAIN_ID=stellar:testnet
```

Notes:

- The app requests a WalletConnect `stellar:*` namespace and stores the connected public key from the approved session.
- `soter://` is configured as the mobile deep-link scheme so the wallet can return the user to Soter after approval.
- SEP-7 transaction URI helpers are included in the mobile wallet service for the next signing flow.

## Health Screen

The Health Screen fetches backend health from `${EXPO_PUBLIC_API_URL}/health`.  
If the backend is unreachable it falls back to mock data.

The screen always shows a small **environment badge** (top-right of the header) and a **footer row** of the form:

```
Environment: dev · localhost:3000
```

This lets testers and field users confirm the API target without navigating to any settings page.

## Scripts

- `pnpm start`: Start Expo dev server with Metro bundler
- `pnpm android`: Run on Android emulator or device
- `pnpm ios`: Run on iOS simulator or device
- `pnpm web`: Run in web browser for testing
- `pnpm test`: Run Jest test suite
- `pnpm lint`: Run ESLint for code quality checks

## Troubleshooting

- **Connection refused**: If running on a physical device, ensure `EXPO_PUBLIC_API_URL` uses your machine's local IP address.
- **Metro not starting**: Try clearing the cache with `expo start -c`.
- **Wrong environment shown**: Verify `.env` contains the correct `EXPO_PUBLIC_ENV_NAME` or `EXPO_PUBLIC_API_URL`, then restart Metro (`expo start -c`).

For detailed development setup, testing procedures, and comprehensive troubleshooting, see [CONTRIBUTING.md](./CONTRIBUTING.md).
