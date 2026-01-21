# Soter Mobile 📱

Mobile application for field operations and pilots, built with Expo and TypeScript.

## Features

- **Home Screen**: Overview and quick actions.
- **Health Screen**: Real-time system status monitoring.
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

## Scripts

- `pnpm start`: Start Expo dev server.
- `pnpm android`: Run on Android.
- `pnpm ios`: Run on iOS.
- `pnpm test`: Run tests with Jest.
- `pnpm lint`: Run ESLint.

## Health Screen

The Health Screen fetches the backend health status from `${EXPO_PUBLIC_API_URL}/health`. 
If the backend is unreachable, it displays mock data to ensure the UI can still be demonstrated.

## Troubleshooting

- **Connection refused**: If running on a physical device, ensure `EXPO_PUBLIC_API_URL` uses your machine's local IP address.
- **Metro not starting**: Try clearing the cache with `expo start -c`.
