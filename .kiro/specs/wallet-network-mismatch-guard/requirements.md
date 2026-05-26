# Requirements Document

## Introduction

The Wallet Network Mismatch Guard is a safety feature for the Soter mobile app (React Native / Expo) that prevents users from performing on-chain actions when their connected wallet is operating on a network other than the expected Testnet. When a WalletConnect session exposes accounts on a chain that does not match `stellar:testnet`, the app must surface a clear warning banner and disable all signing controls until the mismatch is resolved by disconnecting and reconnecting on the correct network.

## Glossary

- **NetworkGuard**: The service module (`NetworkGuard.ts`) responsible for detecting chain ID mismatches between the active WalletConnect session and the expected chain.
- **Expected_Chain_ID**: The chain identifier returned by `getWalletConnectChainId()` from `walletConnect.ts` (e.g. `stellar:testnet`).
- **Session_Chain_IDs**: The list of CAIP-10 chain identifiers extracted from the accounts in the active WalletConnect session (e.g. `["stellar:testnet", "stellar:mainnet"]`).
- **CAIP-10**: Chain Agnostic Improvement Proposal 10 — the account identifier format `<namespace>:<chainId>:<address>` used by WalletConnect (e.g. `stellar:testnet:GABCD…`).
- **MismatchBanner**: The UI component (`MismatchBanner.tsx`) displayed at the top of affected screens when a network mismatch is detected.
- **NetworkMismatch**: A boolean state value that is `true` when at least one Session_Chain_ID does not equal the Expected_Chain_ID, and `false` otherwise.
- **WalletContext**: The React context (`WalletContext.tsx`) that manages wallet connection state and exposes it to the component tree.
- **useNetworkGuard**: The React hook that derives and exposes `networkMismatch` and `sessionChainIds` from WalletContext.
- **Signing_Control**: Any interactive UI element that initiates an on-chain action — specifically the "Confirm Claim" button in `AidDetailsScreen`, the barcode verification action in `BulkScannerScreen`, and the "Upload Evidence" button in `EvidenceUploadScreen`.
- **AidDetailsScreen**: The screen displaying aid package details and hosting the "Confirm Claim" signing control.
- **BulkScannerScreen**: The screen hosting the barcode-based bulk verification signing control.
- **EvidenceUploadScreen**: The screen hosting the evidence upload signing control.

---

## Requirements

### Requirement 1: CAIP-10 Chain ID Extraction

**User Story:** As a developer, I want to extract chain IDs from WalletConnect session accounts, so that the app can determine which networks the connected wallet is operating on.

#### Acceptance Criteria

1. THE NetworkGuard SHALL re-export or wrap the `extractChainIdsFromAccounts` function already present in `walletConnect.ts` so that consumers import from a single service boundary.
2. WHEN a list of CAIP-10 account strings is provided, THE NetworkGuard SHALL return a deduplicated list of chain ID strings in the format `<namespace>:<chainId>`.
3. WHEN an account string does not contain at least two colon-separated segments, THE NetworkGuard SHALL exclude that account from the extracted chain ID list.
4. FOR ALL valid lists of CAIP-10 account strings, parsing the accounts then formatting the chain IDs then parsing again SHALL produce an equivalent deduplicated list (round-trip property).

---

### Requirement 2: Network Mismatch Detection

**User Story:** As a developer, I want the app to detect when the connected wallet's session chains do not match the expected chain, so that unsafe on-chain actions can be blocked.

#### Acceptance Criteria

1. WHEN the Session_Chain_IDs list contains at least one chain ID that is not equal to the Expected_Chain_ID, THE NetworkGuard SHALL set NetworkMismatch to `true`.
2. WHEN all chain IDs in Session_Chain_IDs are equal to the Expected_Chain_ID, THE NetworkGuard SHALL set NetworkMismatch to `false`.
3. WHEN the wallet is disconnected and Session_Chain_IDs is empty, THE NetworkGuard SHALL set NetworkMismatch to `false`.
4. WHEN the Expected_Chain_ID changes (e.g. via environment variable override), THE NetworkGuard SHALL recompute NetworkMismatch against the new Expected_Chain_ID.

---

### Requirement 3: WalletContext Network State Exposure

**User Story:** As a developer, I want WalletContext to expose network mismatch state, so that any component in the tree can react to wallet network changes without prop drilling.

#### Acceptance Criteria

1. THE WalletContext SHALL expose a `networkMismatch: boolean` field in its value interface.
2. THE WalletContext SHALL expose a `sessionChainIds: string[]` field in its value interface.
3. WHEN a wallet session is successfully connected, THE WalletContext SHALL recompute `networkMismatch` and `sessionChainIds` from the session's account list.
4. WHEN a wallet session is restored on app launch, THE WalletContext SHALL recompute `networkMismatch` and `sessionChainIds` from the restored session's account list.
5. WHEN the wallet is disconnected, THE WalletContext SHALL set `networkMismatch` to `false` and `sessionChainIds` to an empty array.

---

### Requirement 4: useNetworkGuard Hook

**User Story:** As a developer, I want a dedicated hook to access network guard state, so that components can consume mismatch information with a clean, consistent API.

#### Acceptance Criteria

1. THE useNetworkGuard hook SHALL return a `networkMismatch: boolean` value derived from WalletContext.
2. THE useNetworkGuard hook SHALL return a `sessionChainIds: string[]` value derived from WalletContext.
3. WHEN called outside a WalletProvider, THE useNetworkGuard hook SHALL throw an error with a descriptive message.
4. WHEN `networkMismatch` changes in WalletContext, THE useNetworkGuard hook SHALL reflect the updated value without requiring a component remount.

---

### Requirement 5: MismatchBanner Component

**User Story:** As a field worker, I want to see a clear warning when my wallet is on the wrong network, so that I understand why on-chain actions are unavailable and know how to resolve the issue.

#### Acceptance Criteria

1. WHEN `networkMismatch` is `true`, THE MismatchBanner SHALL render visibly at the top of the host screen.
2. WHEN `networkMismatch` is `false`, THE MismatchBanner SHALL not render any visible content.
3. WHEN rendered, THE MismatchBanner SHALL display the detected Session_Chain_IDs and the Expected_Chain_ID so the user can identify the discrepancy.
4. WHEN rendered, THE MismatchBanner SHALL include a "Disconnect Wallet" button that invokes `disconnectWallet` from WalletContext.
5. THE MismatchBanner SHALL set `accessibilityRole="alert"` on its root container.
6. THE MismatchBanner SHALL set `accessibilityLiveRegion="assertive"` on its root container so screen readers announce the banner immediately when it appears.

---

### Requirement 6: AidDetailsScreen Signing Control Guard

**User Story:** As a field worker, I want the "Confirm Claim" button to be disabled when my wallet is on the wrong network, so that I cannot accidentally submit an on-chain transaction that will fail.

#### Acceptance Criteria

1. WHEN `networkMismatch` is `true`, THE AidDetailsScreen SHALL render the MismatchBanner above the screen content.
2. WHEN `networkMismatch` is `true`, THE AidDetailsScreen SHALL disable the "Confirm Claim" button.
3. WHEN `networkMismatch` is `false` and the wallet is connected, THE AidDetailsScreen SHALL enable the "Confirm Claim" button (subject to existing confirmation-pending logic).
4. WHEN the "Confirm Claim" button is disabled due to a network mismatch, THE AidDetailsScreen SHALL set `accessibilityState={{ disabled: true }}` on the button.

---

### Requirement 7: BulkScannerScreen Signing Control Guard

**User Story:** As a field worker, I want the barcode verification action to be blocked when my wallet is on the wrong network, so that bulk verification attempts do not fail silently on-chain.

#### Acceptance Criteria

1. WHEN `networkMismatch` is `true`, THE BulkScannerScreen SHALL render the MismatchBanner overlaid on the scanner view.
2. WHEN `networkMismatch` is `true`, THE BulkScannerScreen SHALL prevent the `handleBarCodeScanned` callback from processing scanned codes.
3. WHEN `networkMismatch` is `false` and the wallet is connected, THE BulkScannerScreen SHALL allow `handleBarCodeScanned` to process scanned codes normally.

---

### Requirement 8: EvidenceUploadScreen Signing Control Guard

**User Story:** As a field worker, I want the evidence upload action to be disabled when my wallet is on the wrong network, so that upload attempts tied to on-chain verification cannot proceed in an inconsistent state.

#### Acceptance Criteria

1. WHEN `networkMismatch` is `true`, THE EvidenceUploadScreen SHALL render the MismatchBanner above the screen content.
2. WHEN `networkMismatch` is `true`, THE EvidenceUploadScreen SHALL disable the "Upload Evidence" button.
3. WHEN `networkMismatch` is `false`, THE EvidenceUploadScreen SHALL enable the "Upload Evidence" button (subject to existing image-selection and upload-in-progress logic).
4. WHEN the "Upload Evidence" button is disabled due to a network mismatch, THE EvidenceUploadScreen SHALL set `accessibilityState={{ disabled: true }}` on the button.

---

### Requirement 9: Mismatch Recovery Flow

**User Story:** As a field worker, I want to recover from a network mismatch by disconnecting and reconnecting my wallet on the correct network, so that I can resume on-chain actions without restarting the app.

#### Acceptance Criteria

1. WHEN the user presses "Disconnect Wallet" in the MismatchBanner, THE WalletContext SHALL invoke `disconnectWallet` and transition the wallet status to `idle`.
2. WHEN the wallet status transitions to `idle` after a mismatch disconnect, THE WalletContext SHALL set `networkMismatch` to `false` and `sessionChainIds` to an empty array.
3. WHEN the user reconnects with a wallet session whose Session_Chain_IDs all match the Expected_Chain_ID, THE WalletContext SHALL set `networkMismatch` to `false`.
4. WHEN `networkMismatch` transitions from `true` to `false`, THE AidDetailsScreen, BulkScannerScreen, and EvidenceUploadScreen SHALL re-enable their respective Signing_Controls without requiring a screen navigation.

---

### Requirement 10: Test Coverage

**User Story:** As a developer, I want automated tests covering all mismatch guard scenarios, so that regressions are caught before they reach production.

#### Acceptance Criteria

1. THE test suite SHALL include a test verifying that `networkMismatch` is `true` when a non-Testnet chain ID is present in Session_Chain_IDs.
2. THE test suite SHALL include a test verifying that `networkMismatch` is `false` when all Session_Chain_IDs match the Expected_Chain_ID.
3. THE test suite SHALL include a test verifying that `networkMismatch` is `false` when the wallet is disconnected.
4. THE test suite SHALL include a test verifying that MismatchBanner renders when `networkMismatch` is `true` and does not render when `networkMismatch` is `false`.
5. THE test suite SHALL include a test verifying that Signing_Controls are disabled when `networkMismatch` is `true`.
6. THE test suite SHALL include a test verifying that Signing_Controls are enabled when `networkMismatch` is `false` and the wallet is connected.
7. THE test suite SHALL include a test verifying the full recovery flow: mismatch detected → disconnect → reconnect on correct network → mismatch resolved.
8. THE test suite SHALL include a property-based test verifying the round-trip property for CAIP-10 chain ID extraction: for any valid list of CAIP-10 account strings, `extractChainIdsFromAccounts` produces a result that is stable under a second application (idempotent).
