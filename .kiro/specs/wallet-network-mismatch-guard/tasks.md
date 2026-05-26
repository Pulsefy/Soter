# Implementation Tasks

## Tasks

- [x] 1. Create NetworkGuard service
  - [x] 1.1 Create `app/mobile/src/services/NetworkGuard.ts` with `detectNetworkMismatch` function and re-export of `extractChainIdsFromAccounts`

- [x] 2. Extend WalletContext with network mismatch state
  - [x] 2.1 Add `networkMismatch: boolean` and `sessionChainIds: string[]` to `WalletContextValue` interface
  - [x] 2.2 Add state variables and `applyNetworkGuard` helper inside `WalletProvider`
  - [x] 2.3 Call `applyNetworkGuard` on session restore, new connection, and disconnect

- [x] 3. Create useNetworkGuard hook
  - [x] 3.1 Create `app/mobile/src/hooks/useNetworkGuard.ts` that reads from WalletContext

- [x] 4. Create MismatchBanner component
  - [x] 4.1 Create `app/mobile/src/components/MismatchBanner.tsx` with accessibility attributes, chain ID display, and Disconnect Wallet button

- [x] 5. Integrate MismatchBanner into AidDetailsScreen
  - [x] 5.1 Add `MismatchBanner` render and disable Confirm Claim button when `networkMismatch` is true

- [x] 6. Integrate MismatchBanner into BulkScannerScreen
  - [x] 6.1 Add `MismatchBanner` overlay and block `handleBarCodeScanned` when `networkMismatch` is true

- [x] 7. Integrate MismatchBanner into EvidenceUploadScreen
  - [x] 7.1 Add `MismatchBanner` render and disable Upload Evidence button when `networkMismatch` is true

- [x] 8. Write tests
  - [x] 8.1 Create `app/mobile/src/__tests__/networkMismatchGuard.test.tsx` covering all 8 required scenarios
