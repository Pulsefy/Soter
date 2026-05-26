# Requirements Document

## Introduction

The Wallet Network Mismatch Guard protects the Soter mobile app from executing on-chain actions when the connected wallet is operating on the wrong Stellar network. Soter is configured to run exclusively on Testnet. If a user connects a wallet that has approved accounts on Mainnet (or any network other than Testnet), any action that requires a transaction signature — claim confirmation, evidence upload, bulk scan verification — must be blocked until the mismatch is resolved.

The guard must detect the mismatch as early as possible (at connection time and on session restore), surface a clear, actionable error to the user, and provide a guided remediation path. All mismatch and recovery flows must be covered by automated tests.

## Glossary

- **Guard**: The Wallet Network Mismatch Guard — the feature described in this document.
- **Mismatch**: The condition where the wallet's active chain ID does not equal the app's configured chain ID (`stellar:testnet` by default).
- **Expected_Chain_ID**: The chain ID the app is configured to use, derived from `EXPO_PUBLIC_WALLETCONNECT_STELLAR_CHAIN_ID` or `EXPO_PUBLIC_NETWORK` (defaults to `stellar:testnet`).
- **Session_Chain_IDs**: The set of CAIP-10 chain IDs extracted from the accounts approved by the connected wallet session (e.g., `stellar:testnet`, `stellar:mainnet`).
- **Signing_Action**: Any user-initiated operation that requires a wallet signature: claim confirmation, bulk scan verification, evidence upload submission, or any future SEP-7 / `stellar_signXDR` call.
- **WalletContext**: The React context (`WalletContext.tsx`) that manages wallet connection state and exposes it to the app.
- **NetworkGuard**: The new service/hook responsible for comparing Session_Chain_IDs against Expected_Chain_ID and exposing the mismatch state.
- **MismatchBanner**: The UI component that renders the network mismatch warning and remediation controls.
- **Remediation**: The set of actions available to the user to resolve a mismatch: switch the wallet to Testnet, or disconnect and reconnect with a Testnet-enabled wallet.

---

## Requirements

### Requirement 1: Network Mismatch Detection

**User Story:** As a Soter operator, I want the app to detect when my connected wallet is on the wrong Stellar network, so that I am never silently operating on Mainnet when Testnet is required.

#### Acceptance Criteria

1. WHEN a wallet session is established via WalletConnect, THE NetworkGuard SHALL compare each chain ID in Session_Chain_IDs against Expected_Chain_ID.
2. WHEN a wallet session is restored from a persisted WalletConnect session on app launch, THE NetworkGuard SHALL perform the same chain ID comparison as on a new connection.
3. WHEN all chain IDs in Session_Chain_IDs match Expected_Chain_ID, THE NetworkGuard SHALL set the mismatch state to `false`.
4. WHEN at least one chain ID in Session_Chain_IDs does not match Expected_Chain_ID, THE NetworkGuard SHALL set the mismatch state to `true`.
5. WHEN the wallet is disconnected, THE NetworkGuard SHALL reset the mismatch state to `false`.
6. THE NetworkGuard SHALL expose the mismatch state and the detected Session_Chain_IDs to consumers via a React hook (`useNetworkGuard`).

---

### Requirement 2: Block Signing Actions on Mismatch

**User Story:** As a Soter operator, I want the app to prevent me from submitting transactions when my wallet is on the wrong network, so that I cannot accidentally sign Mainnet transactions or corrupt on-chain state.

#### Acceptance Criteria

1. WHILE the mismatch state is `true`, THE Guard SHALL prevent the Confirm Claim action from being submitted in `AidDetailsScreen`.
2. WHILE the mismatch state is `true`, THE Guard SHALL prevent the bulk scan verification action from being submitted in `BulkScannerScreen`.
3. WHILE the mismatch state is `true`, THE Guard SHALL prevent the evidence upload submission action from being submitted in `EvidenceUploadScreen`.
4. WHILE the mismatch state is `true`, THE Guard SHALL disable the interactive controls for each blocked Signing_Action and set their `accessibilityState.disabled` to `true`.
5. WHILE the mismatch state is `true`, THE Guard SHALL render the MismatchBanner in each screen that contains a Signing_Action.
6. WHILE the mismatch state is `false` and the wallet is connected, THE Guard SHALL allow all Signing_Actions to proceed normally.

---

### Requirement 3: Mismatch Banner and User Notification

**User Story:** As a Soter operator, I want a clear, visible warning when my wallet is on the wrong network, so that I understand why my actions are blocked and know how to fix the problem.

#### Acceptance Criteria

1. WHEN the mismatch state is `true`, THE MismatchBanner SHALL be rendered at the top of every screen that contains a Signing_Action.
2. THE MismatchBanner SHALL display the detected Session_Chain_IDs and the Expected_Chain_ID so the user can identify the discrepancy.
3. THE MismatchBanner SHALL include a "Disconnect Wallet" button that invokes the `disconnectWallet` function from WalletContext.
4. THE MismatchBanner SHALL carry `accessibilityRole="alert"` and `accessibilityLiveRegion="assertive"` so screen readers announce the mismatch immediately.
5. WHEN the mismatch state transitions from `true` to `false`, THE MismatchBanner SHALL be removed from the screen without requiring a manual page reload.
6. IF the mismatch state is `false`, THEN THE MismatchBanner SHALL not be rendered.

---

### Requirement 4: Remediation Flow

**User Story:** As a Soter operator, I want guided steps to fix a network mismatch, so that I can quickly reconnect with the correct wallet configuration and resume my work.

#### Acceptance Criteria

1. WHEN the user taps "Disconnect Wallet" in the MismatchBanner, THE WalletContext SHALL disconnect the current session and reset the wallet state to `idle`.
2. WHEN the wallet state returns to `idle` after a mismatch-triggered disconnect, THE Guard SHALL reset the mismatch state to `false`.
3. WHEN the user initiates a new wallet connection after a mismatch-triggered disconnect, THE Guard SHALL evaluate the new session's chain IDs and set the mismatch state accordingly.
4. WHEN a new session is approved with chain IDs that all match Expected_Chain_ID, THE Guard SHALL set the mismatch state to `false` and unblock all Signing_Actions.
5. IF a new session is approved with chain IDs that do not match Expected_Chain_ID, THEN THE Guard SHALL immediately set the mismatch state to `true` and block all Signing_Actions.

---

### Requirement 5: WalletContext Network Awareness

**User Story:** As a developer, I want the WalletContext to expose network mismatch information alongside connection state, so that any component in the app can react to mismatches without duplicating detection logic.

#### Acceptance Criteria

1. THE WalletContext SHALL expose a `networkMismatch` boolean derived from the NetworkGuard.
2. THE WalletContext SHALL expose a `sessionChainIds` string array containing the chain IDs from the active session, or an empty array when no session is active.
3. WHEN the wallet status is not `connected`, THE WalletContext SHALL set `networkMismatch` to `false` and `sessionChainIds` to an empty array.
4. THE WalletContext SHALL recompute `networkMismatch` and `sessionChainIds` whenever the wallet session changes (new connection, session restore, or disconnect).

---

### Requirement 6: Test Coverage for Mismatch and Recovery Flows

**User Story:** As a developer, I want automated tests for all mismatch detection and recovery scenarios, so that regressions are caught before they reach production.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test that verifies the NetworkGuard sets mismatch state to `true` when Session_Chain_IDs contain a non-Testnet chain ID.
2. THE Test_Suite SHALL include a test that verifies the NetworkGuard sets mismatch state to `false` when all Session_Chain_IDs match Expected_Chain_ID.
3. THE Test_Suite SHALL include a test that verifies the NetworkGuard sets mismatch state to `false` when the wallet is disconnected.
4. THE Test_Suite SHALL include a test that verifies the MismatchBanner is rendered when mismatch state is `true` and is absent when mismatch state is `false`.
5. THE Test_Suite SHALL include a test that verifies Signing_Action controls are disabled when mismatch state is `true`.
6. THE Test_Suite SHALL include a test that verifies Signing_Action controls are enabled when mismatch state is `false` and the wallet is connected.
7. THE Test_Suite SHALL include a test that verifies the full recovery flow: mismatch detected → user disconnects → reconnects with correct network → mismatch resolved → Signing_Actions unblocked.
8. FOR ALL valid CAIP-10 account arrays, THE NetworkGuard SHALL correctly extract chain IDs and produce a mismatch result consistent with comparing those chain IDs against Expected_Chain_ID (round-trip property between `extractChainIdsFromAccounts` and the mismatch check).
