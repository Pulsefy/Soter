# Certificate Pinning for API Traffic

## Overview

The mobile app pins the backend API's TLS certificate using SSL public key
pinning, so requests are rejected if the server presents a certificate that
doesn't match a known, trusted key. This protects evidence uploads and claim
submissions from interception or tampering by a malicious proxy on networks
the team doesn't control (public Wi-Fi, shared field connections, etc.).

Pinning is implemented with
[`react-native-ssl-public-key-pinning`](https://github.com/frw/react-native-ssl-public-key-pinning),
which validates the base64-encoded SHA-256 hash of the server certificate's
Subject Public Key Info (SPKI) using OkHttp `CertificatePinner` on Android and
TrustKit on iOS. Once initialized, every request made through `fetch` is
covered automatically — no per-call changes are needed.

## Behavior

- **Pin validation failure blocks the request.** A pin mismatch fails the TLS
  handshake, so the underlying `fetch()` call rejects. [`src/services/certificatePinning.ts`](src/services/certificatePinning.ts)
  correlates that rejection with the mismatch event and re-throws a
  `CertificatePinningError` with a clear, user-facing security message instead
  of a generic network error.
- **Backup pins.** At least two `publicKeyHashes` must be configured per host
  — this is enforced both by our config validation and by TrustKit on iOS,
  which throws if fewer than two pins are provided. Always keep a backup pin
  for the *next* certificate so rotation doesn't lock out existing app
  installs (see [Rotation Procedure](#rotation-procedure)).
- **Disabled for local/dev backends.** Pinning is skipped whenever the API
  host resolves to a loopback or emulator address (`localhost`, `127.0.0.1`,
  `10.0.2.2`, `::1`) — the addresses used to reach a locally-running backend
  during development. This is checked at runtime in `initializeCertificatePinning`,
  regardless of `EXPO_PUBLIC_ENV_NAME`.
- **Disabled in Expo Go.** `react-native-ssl-public-key-pinning` requires a
  native module, which Expo Go does not provide. `isSslPinningAvailable()`
  detects this and pinning is skipped with a console warning; requests are
  unpinned in Expo Go regardless of environment.

## Configuration

| Env var | Required | Description |
|---|---|---|
| `EXPO_PUBLIC_CERT_PIN_HASHES` | Yes, for prod/staging | Comma-separated list of base64-encoded SHA-256 SPKI hashes. Must include the primary pin plus at least one backup. |
| `EXPO_PUBLIC_CERT_PIN_INCLUDE_SUBDOMAINS` | No | `"true"` to also pin all subdomains of the API host. Defaults to `false`. |

If fewer than two hashes are configured, pinning initialization is skipped
(logged via `console.warn`) rather than blocking all traffic — this avoids
bricking a build over a missing/misconfigured env var. Treat that warning as
a release blocker for production builds.

### Getting a certificate's public key hash

```sh
echo | openssl s_client -servername <hostname> -connect <hostname>:443 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

## Rotation Procedure

Certificate/key rotation must be planned ahead of the certificate's expiry —
an unplanned rotation risks shipping an app update whose only pin no longer
matches the live server, which blocks all API traffic until users update.

1. **T-minus 30 days (lead time):** Generate the new certificate/key pair and
   compute its SPKI hash using the command above, without deploying it yet.
2. **Add the new hash as a backup pin.** Update `EXPO_PUBLIC_CERT_PIN_HASHES`
   to include the new hash alongside the still-active current pin, and ship
   an app update (or OTA update via `expo-updates`, since pin configuration
   is JS-only) with both pins present.
3. **Wait for adoption.** Give installs time to pick up the update before
   rotating the server certificate — track this via release adoption metrics.
   Do not proceed until the large majority of active installs have the
   two-pin build; there is no fixed floor, but treat low adoption as a reason
   to hold rotation.
4. **Rotate the server certificate/key** to the one matching the new pin.
   Because it was already shipped as a backup pin, existing installs
   continue to validate successfully.
5. **T-plus 30 days:** Once the old certificate is fully retired, ship a
   follow-up update that drops the old pin and adds a fresh backup pin for
   the *next* rotation, so there are always at least two valid pins in the
   field.

If a rotation must happen faster than the lead time allows (e.g. emergency
key compromise), skip step 3's adoption wait and treat degraded connectivity
for outdated installs as expected until they update — this is the tradeoff
pinning makes for security, and is why a backup pin should always be staged
in advance rather than only added reactively.

## Testing

- [`src/__tests__/certificatePinning.test.ts`](src/__tests__/certificatePinning.test.ts)
  covers hostname parsing, local-backend detection, initialization
  skip/enable paths, and the pin-mismatch-to-`CertificatePinningError`
  correlation.
- To manually verify pinning is active on a build, temporarily set
  `EXPO_PUBLIC_CERT_PIN_HASHES` to two incorrect hashes — requests to the API
  should fail immediately. Restore the correct hashes afterward.
