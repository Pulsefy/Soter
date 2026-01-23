# WalletConnect v2 Setup Guide

This guide explains how to set up WalletConnect v2 for Stellar wallet integration in the Soter mobile app.

## Prerequisites

1. A WalletConnect Cloud account
2. A Project ID from WalletConnect Cloud Dashboard

## Setup Steps

### 1. Get Your WalletConnect Project ID

1. Go to [WalletConnect Cloud Dashboard](https://cloud.walletconnect.com)
2. Sign up or log in
3. Create a new project
4. Copy your Project ID

### 2. Configure Project ID

You have two options to set your Project ID:

#### Option A: Environment Variable (Recommended)

Create a `.env` file in the `app/mobile` directory:

```env
EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

#### Option B: Direct Configuration

Edit `app/mobile/src/services/walletConnect.ts` and replace:

```typescript
const PROJECT_ID = 'YOUR_PROJECT_ID_HERE';
```

with your actual Project ID.

### 3. Install Dependencies

The required dependencies are already listed in `package.json`. Install them by running:

```bash
cd app/mobile
npm install
# or
pnpm install
```

### 4. Deep Linking Configuration

Deep linking is already configured in `app.json` with the scheme `soter://`. This allows the app to:
- Receive deep links from wallet apps
- Redirect back to the app after wallet approval

## How It Works

1. **User clicks "Connect Wallet"** - The app generates a WalletConnect URI
2. **QR Code Display** - The URI is displayed as a QR code
3. **User scans with wallet** - User opens their Stellar wallet (LOBSTR, Beans, etc.) and scans the QR code
4. **Wallet approval** - User approves the connection in their wallet app
5. **Session established** - The app receives the user's public key and displays it

## Supported Wallets

The following Stellar wallets support WalletConnect v2:
- LOBSTR
- Beans
- Freighter (via WalletConnect)

## Testing

1. Start the Expo development server:
   ```bash
   npm start
   ```

2. Open the app on your device or emulator

3. Click "Connect Wallet"

4. Scan the QR code with a supported Stellar wallet app

5. Approve the connection in your wallet

6. Verify that your public key is displayed in the app

## Troubleshooting

### Connection Timeout
- Ensure your wallet app supports WalletConnect v2
- Check that you're using a valid Project ID
- Verify your internet connection

### QR Code Not Displaying
- Check the console for errors
- Ensure WalletConnect is properly initialized
- Verify that the Project ID is set correctly

### Session Not Establishing
- Make sure you've approved the connection in your wallet app
- Check that the wallet app is connected to the internet
- Try disconnecting and reconnecting

## Next Steps

After successfully connecting a wallet, you can:
- Sign transactions using the connected wallet
- Request account information
- Listen for account changes

For transaction signing, use the `walletConnectService` to send signing requests to the connected wallet.

