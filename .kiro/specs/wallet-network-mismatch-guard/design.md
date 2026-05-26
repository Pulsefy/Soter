# Design Document: Wallet Network Mismatch Guard

## Overview

This feature adds a network mismatch guard to the Soter mobile app. It detects when a connected WalletConnect session exposes accounts on a chain other than the expected `stellar:testnet`, surfaces a `MismatchBanner` on affected screens, and disables all signing controls until the user disconnects and reconnects on the correct network.

The implementation touches four layers:
1. **Service** — `NetworkGuard.ts` (pure logic, no React)
2. **Context** — `WalletContext.tsx` extended with `networkMismatch` and `sessionChainIds`
3. **Hook** — `useNetworkGuard.ts` (thin selector over WalletContext)
4. **UI** — `MismatchBanner.tsx` + integration into three screens

---

## Architecture

```
walletConnect.ts
  └─ extractChainIdsFromAccounts()   ← already exists
  └─ getWalletConnectChainId()       ← already exists

NetworkGuard.ts  (new)
  └─ re-exports extractChainIdsFromAccounts
  └─ detectNetworkMismatch(chainIds, expectedChainId) → boolean

WalletContext.tsx  (extended)
  └─ state: sessionChainIds: string[]
  └─ state: networkMismatch: boolean
  └─ recomputed on: connect, restore, disconnect

useNetworkGuard.ts  (new hook)
  └─ reads networkMismatch + sessionChainIds from WalletContext

MismatchBanner.tsx  (new component)
  └─ reads useNetworkGuard + useWallet (for disconnectWallet)
  └─ renders when networkMismatch === true

AidDetailsScreen.tsx  (modified)
  └─ renders <MismatchBanner />
  └─ disables Confirm Claim when networkMismatch

BulkScannerScreen.tsx  (modified)
  └─ renders <MismatchBanner /> overlaid
  └─ blocks handleBarCodeScanned when networkMismatch

EvidenceUploadScreen.tsx  (modified)
  └─ renders <MismatchBanner />
  └─ disables Upload Evidence when networkMismatch
```

---

## Component & Module Designs

### 1. `NetworkGuard.ts`

**Location:** `app/mobile/src/services/NetworkGuard.ts`

```typescript
// Re-export so consumers have a single import boundary
export { extractChainIdsFromAccounts } from './walletConnect';

/**
 * Returns true when any session chain ID does not match the expected chain.
 * Returns false when chainIds is empty (disconnected) or all match.
 */
export const detectNetworkMismatch = (
  chainIds: string[],
  expectedChainId: string,
): boolean => {
  if (chainIds.length === 0) return false;
  return chainIds.some((id) => id !== expectedChainId);
};
```

**Correctness properties:**
- `detectNetworkMismatch([], any)` → `false`
- `detectNetworkMismatch([expected], expected)` → `false`
- `detectNetworkMismatch([other], expected)` → `true`
- `detectNetworkMismatch([expected, other], expected)` → `true`

---

### 2. `WalletContext.tsx` — Extended Interface

New fields added to `WalletContextValue`:

```typescript
interface WalletContextValue {
  // ... existing fields ...
  networkMismatch: boolean;
  sessionChainIds: string[];
}
```

New state variables inside `WalletProvider`:

```typescript
const [sessionChainIds, setSessionChainIds] = useState<string[]>([]);
const [networkMismatch, setNetworkMismatch] = useState(false);
```

Helper to apply network guard state from a session:

```typescript
const applyNetworkGuard = (chainIds: string[]) => {
  setSessionChainIds(chainIds);
  setNetworkMismatch(detectNetworkMismatch(chainIds, getWalletConnectChainId()));
};
```

Called in three places:
- `applyConnectedSession(session)` — on restore
- After `approval()` resolves — on new connection
- `resetWalletState()` — clears to `[]` / `false`

---

### 3. `useNetworkGuard.ts`

**Location:** `app/mobile/src/hooks/useNetworkGuard.ts`

```typescript
export interface NetworkGuardState {
  networkMismatch: boolean;
  sessionChainIds: string[];
}

export const useNetworkGuard = (): NetworkGuardState => {
  const { networkMismatch, sessionChainIds } = useWallet();
  return { networkMismatch, sessionChainIds };
};
```

Throws via `useWallet()` if called outside `WalletProvider`.

---

### 4. `MismatchBanner.tsx`

**Location:** `app/mobile/src/components/MismatchBanner.tsx`

Props:
```typescript
interface Props {
  expectedChainId: string;
}
```

Internally calls `useNetworkGuard()` for `networkMismatch` and `sessionChainIds`, and `useWallet()` for `disconnectWallet`.

Renders `null` when `networkMismatch === false`.

When visible:
- Red/warning background (`#FEF2F2` / `#DC2626`)
- Shows: "Wrong network detected"
- Shows detected chains: e.g. `stellar:mainnet`
- Shows expected chain: e.g. `stellar:testnet`
- "Disconnect Wallet" `TouchableOpacity` button
- `accessibilityRole="alert"`
- `accessibilityLiveRegion="assertive"`

---

### 5. Screen Integrations

#### AidDetailsScreen
- Import `MismatchBanner` and `useNetworkGuard`
- Render `<MismatchBanner expectedChainId={getWalletConnectChainId()} />` at top of `ScrollView` content (after `SaverModeBanner`)
- Add `networkMismatch` to the `disabled` condition of the Confirm Claim button

#### BulkScannerScreen
- Import `MismatchBanner` and `useNetworkGuard`
- Render `<MismatchBanner expectedChainId={getWalletConnectChainId()} />` inside the overlay `View`
- Add `|| networkMismatch` to the `handleBarCodeScanned` early-return guard

#### EvidenceUploadScreen
- Import `MismatchBanner` and `useNetworkGuard`
- Render `<MismatchBanner expectedChainId={getWalletConnectChainId()} />` at top of `ScrollView` content
- Add `|| networkMismatch` to the Upload Evidence button's `disabled` prop and `accessibilityState`

---

## Data Flow

```
WalletConnect session approved / restored
        │
        ▼
WalletContext.applyNetworkGuard(session.chainIds)
        │
        ├─► setSessionChainIds(chainIds)
        └─► setNetworkMismatch(detectNetworkMismatch(chainIds, expectedChainId))
                │
                ▼
        WalletContext.value.networkMismatch / sessionChainIds
                │
                ▼
        useNetworkGuard() hook (in MismatchBanner + screens)
                │
                ├─► MismatchBanner renders / hides
                └─► Signing controls enabled / disabled
```

---

## Test Plan

**File:** `app/mobile/src/__tests__/networkMismatchGuard.test.tsx`

| # | Scenario | Approach |
|---|----------|----------|
| 1 | `networkMismatch` true when non-Testnet chain detected | Unit test `detectNetworkMismatch` |
| 2 | `networkMismatch` false when all chains match Testnet | Unit test `detectNetworkMismatch` |
| 3 | `networkMismatch` false on wallet disconnect | Unit test `detectNetworkMismatch([], ...)` |
| 4 | `MismatchBanner` renders when mismatched, hidden when not | RTL render test with mocked `useWallet` |
| 5 | Signing controls disabled when mismatched | RTL render test on each screen |
| 6 | Signing controls enabled when matched and connected | RTL render test on each screen |
| 7 | Full recovery flow | RTL `act()` sequence: mismatch → disconnect → reconnect |
| 8 | CAIP-10 round-trip property | Idempotency test: `extractChainIdsFromAccounts(extractChainIdsFromAccounts(accounts).map(id => id + ':ADDR'))` |

All tests use Jest + `@testing-library/react-native`. No new test dependencies required.
