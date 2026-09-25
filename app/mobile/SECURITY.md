# Security — Wallet Credential Storage

This document describes how the Soter mobile app stores sensitive wallet
credentials and auth tokens, where those values live on the device, and
the threat model the approach is designed to address.

---

## Sensitive values managed

| Constant | Key string | Purpose |
|---|---|---|
| `SECURE_KEY_WC_SESSION` | `@soter/secure/wc_session` | WalletConnect session topic — used to reattach to a live relay session on cold start |
| `SECURE_KEY_AUTH_TOKEN` | `@soter/secure/auth_token` | Bearer token for Soter backend API calls |
| `SECURE_KEY_REFRESH_TOKEN` | `@soter/secure/refresh_token` | Refresh token for re-issuing short-lived auth tokens |

All three values are managed exclusively by
`app/mobile/src/services/secureStorage.ts`.

---

## Storage location

### iOS — Keychain

Values are written to the **iOS Keychain** via `expo-secure-store` using the
accessibility attribute
[`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly).

Key properties of this attribute:

- **After first unlock** — the item becomes accessible after the device is
  unlocked once following a reboot.  This allows background processes (e.g.
  push-notification handlers) to read the session without requiring the user to
  be actively looking at the screen.
- **ThisDeviceOnly** — the item is **not** migrated to iCloud Keychain and is
  **not** included in encrypted device backups (iTunes / Finder / iCloud).  If
  the user restores a backup onto a new device the values will be absent and a
  fresh authentication is required.

### Android — Keystore

Values are stored in the **Android Keystore** via `expo-secure-store`.  The
Keystore system never exports raw key material.  Items stored through this
path are excluded from ADB backups and Google Drive Auto-backup by default;
the `allowBackup` manifest attribute does not affect Keystore-protected data.

---

## Backup exclusion

Backup exclusion is enforced through the platform-native mechanisms described
above.  No additional `android:allowBackup="false"` or NSFileProtection
configuration is needed for these specific items because the `ThisDeviceOnly`
Keychain constraint and the Keystore backing already provide the same guarantee
at the OS level.

---

## Migration from AsyncStorage (one-shot)

Prior to this change (issue #924) session material was stored in React Native
`AsyncStorage`, which is a plain SQLite or flat-file store with **no
encryption** on either platform.

On first launch after upgrading, `migrateFromAsyncStorage()` runs
automatically during the `WalletProvider` bootstrap:

1. For each managed key, check whether the value already exists in secure
   storage.  If so, skip (idempotent).
2. If the value exists in AsyncStorage, copy it to secure storage, then
   **delete** the AsyncStorage entry.
3. If the value is absent from both stores, no action is taken.

The migration function never throws.  Per-key failures are collected in a
`result.failed` array for observability but do not interrupt the app startup.

Legacy AsyncStorage keys that are evacuated:

| Secure key | Legacy AsyncStorage key |
|---|---|
| `@soter/secure/wc_session` | `@soter/wc_session` |
| `@soter/secure/auth_token` | `@soter/auth_token` |
| `@soter/secure/refresh_token` | `@soter/refresh_token` |

---

## Fail-closed contract

`secureRead()` returns `null` on **any** error — missing key, hardware
unavailable, Secure Enclave failure, permission denied, OS version too old.

Callers **must not** fall back to insecure storage when `secureRead` returns
`null`.  Instead they must treat the result as unauthenticated and surface a
re-authentication prompt.

`secureWrite()` throws `SecureStorageUnavailableError` if the platform
Keychain / Keystore rejects the write.  `WalletContext` catches this and sets
`secureStorageUnavailable = true`, which `useWalletSession` exposes as the
`secureStorageUnavailable` flag.  The `WalletSessionBanner` component renders a
"Unlock your device to continue" prompt and calls `reauthenticate()` when the
user taps it.

---

## Threat model

### Threats addressed

| Threat | Mitigation |
|---|---|
| **Rooted / jailbroken device reads AsyncStorage** | Values no longer stored in AsyncStorage; Keychain/Keystore access is blocked on a rooted Android device by the Keystore attestation chain |
| **Device backup exfiltration** | `ThisDeviceOnly` Keychain attribute and Keystore design prevent export via iCloud, iTunes, Finder, ADB, or Google Drive backups |
| **Shared-device session hijack** | Session topics and tokens are wiped on explicit disconnect (`secureClearAll()`); re-authentication is required after device lock when the Keystore/Keychain is sealed |
| **Cold-start credential theft** | `AFTER_FIRST_UNLOCK` ensures items are not readable until the user has provided their PIN/biometric at least once after reboot |
| **Memory scraping via insecure transport** | Values are never written to logs; `secureRead` never propagates raw values in error messages |

### Threats not fully addressed

| Threat | Notes |
|---|---|
| **Compromised Secure Enclave / vendor backdoor** | This is a hardware-level risk outside the application's control |
| **Malicious app with overlapping bundle ID** | iOS and Android both scope Keychain/Keystore access to the signing certificate; a different certificate cannot read these values |
| **Session token leakage over network** | Out of scope for this module — see certificate pinning (`CERTIFICATE_PINNING.md`) and TLS configuration in the backend |

---

## Code references

| File | Role |
|---|---|
| `app/mobile/src/services/secureStorage.ts` | Core read/write/delete/migrate API |
| `app/mobile/src/services/walletConnect.ts` | Persists and removes `SECURE_KEY_WC_SESSION` on connect/disconnect |
| `app/mobile/src/contexts/WalletContext.tsx` | Calls `migrateFromAsyncStorage()` on bootstrap; calls `secureClearAll()` on disconnect |
| `app/mobile/src/hooks/useWalletSession.ts` | Exposes `secureStorageUnavailable` and `reauthenticate()` to UI |
| `app/mobile/src/__tests__/secureStorage.test.ts` | Unit tests for all storage operations and migration logic |
