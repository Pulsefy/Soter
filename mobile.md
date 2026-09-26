# Mobile Issues

## Wave 8

Wave 8 mobile work removes the last mock fallbacks from field screens, hardens the app for
untrusted networks and shared devices, and adds the measurement and testing infrastructure the app
needs before real field deployment. Wave 7 delivered offline queue inspection, background upload
persistence, wallet reconnect, deep-link routing, the theme and accessibility pass, and diagnostics
export; these issues extend that work.

---

## Issue 1: Retire Mock Data Fallbacks From Field Screens
**Labels:** Mobile, chore, integration, ux, reliability
**Complexity:** Medium (150)

**Description**
`app/mobile/src/services/mockData.ts` is still consumed by production screens.
`HealthScreen.tsx` imports `getMockHealthData` and, when the backend is unreachable, renders
fabricated health values behind a `🔧 MOCK` badge (lines ~18, 44, 71-77, 236, 370).
`AidDetailsScreen.tsx` imports `getMockAidDetails` and silently falls back to it at line ~91 with
no badge at all, so a field worker cannot tell whether aid details are real.

Replace fabricated data with an honest unavailable state.

**Acceptance Criteria**
- Neither `HealthScreen` nor `AidDetailsScreen` renders mock data in a production build
- Backend unavailability shows an explicit unavailable state with a retry action
- Cached real data is preferred over mock data and is labelled with its age
- `mockData.ts` is reachable only from tests and development builds
- Tests cover the unreachable-backend path for both screens

---

## Issue 2: Store Wallet Credentials in Platform Secure Storage
**Labels:** Mobile, security, wallet, auth, privacy
**Complexity:** Hard (200)

**Description**
`app/mobile/src/services/walletConnect.ts` manages wallet sessions for a device used in the field
and potentially shared between workers. Session material must live in the iOS Keychain and Android
Keystore rather than in general application storage, which is readable on a rooted or jailbroken
device and can be captured in device backups.

**Acceptance Criteria**
- Wallet session material and auth tokens are stored in platform secure storage
- Stored items are excluded from device backups
- Existing values in insecure storage are migrated once and then removed
- Reads fail closed with a re-authentication prompt when secure storage is unavailable
- The storage location and threat model are documented

---

## Issue 3: Add Crash and Error Reporting
**Labels:** Mobile, observability, reliability, ops
**Complexity:** Medium (150)

**Description**
The app has no crash reporting. A crash on a field worker's device in an area with poor
connectivity is entirely invisible to the team, and the only signal is a worker reporting that the
app "stopped working" without reproduction detail.

**Acceptance Criteria**
- Native and JavaScript crashes are captured with stack traces and app version
- Reports queue locally while offline and upload when connectivity returns
- Personally identifiable data and evidence content are excluded from reports
- Reporting is disclosed to users and can be disabled
- Release version and build number are attached to every report

---

## Issue 4: Require Device Biometric Confirmation for Claim Actions
**Labels:** Mobile, security, auth, feature, wallet
**Complexity:** Medium (150)

**Description**
Claim and disbursement actions initiated from `ClaimReceiptScreen.tsx` and
`AidDetailsScreen.tsx` move real value but require only that the app is open. On a shared or
briefly unattended field device, anyone can submit a claim.

**Acceptance Criteria**
- Value-moving actions require device biometric or passcode confirmation
- A clear fallback exists on devices without biometric hardware
- Confirmation is cached for a short configurable window to avoid prompting repeatedly
- Failed or cancelled confirmation aborts the action without side effects
- Tests cover success, cancellation, and unavailable-hardware paths

---

## Issue 5: Pin Backend Certificates for API Traffic
**Labels:** Mobile, security, integration, reliability
**Complexity:** Hard (200)

**Description**
`app/mobile/src/services/api.ts` talks to the backend over networks the team does not control,
including public and shared connections in the field. Without certificate pinning, an intercepting
proxy can observe and modify evidence uploads and claim submissions.

**Acceptance Criteria**
- API traffic validates against pinned certificates or public keys
- At least one backup pin is included so certificate rotation does not brick clients
- Pin validation failure blocks the request and surfaces a clear security error
- Pinning is disabled in development builds against local backends
- The rotation procedure is documented with lead-time requirements

---

## Issue 6: Bound and Evict Local Caches
**Labels:** Mobile, performance, reliability, data-model
**Complexity:** Medium (150)

**Description**
`app/mobile/src/services/aidCache.ts` and `taskCache.ts` persist aid and task data for offline
use, but neither bounds its size or evicts stale entries. On a long field deployment the cache grows
until the device runs out of storage, which also breaks evidence capture.

**Acceptance Criteria**
- Each cache enforces a configurable maximum size
- Eviction uses a documented policy and never discards unsynced local changes
- Current cache size is visible in settings with a manual clear action
- Approaching the storage limit surfaces a warning
- Tests cover eviction ordering and preservation of unsynced data

---

## Issue 7: Schedule Background Sync With Battery and Network Awareness
**Labels:** Mobile, performance, reliability, ops, feature
**Complexity:** Hard (200)

**Description**
`app/mobile/src/services/syncQueue.ts` drains queued work, but scheduling does not account for
battery level or connection type. Uploading evidence over a metered connection at low battery is
exactly the wrong behaviour for a field device that must last a full working day.

**Acceptance Criteria**
- Sync defers large uploads on metered connections unless the user opts in
- Sync backs off below a configurable battery threshold
- Urgent items bypass deferral according to a documented rule
- The user can force an immediate sync and see why sync is currently deferred
- Deferral reasons are recorded for diagnostics

---

## Issue 8: Recover Gracefully From Denied Camera Permission
**Labels:** Mobile, ux, reliability, bug
**Complexity:** Trivial (100)

**Description**
`ScannerScreen.tsx`, `BulkScannerScreen.tsx`, and `EvidenceUploadScreen.tsx` depend on camera
access. When permission is denied or revoked in system settings, these screens offer no explanation
and no route to recovery, which for a field worker reads as the app being broken.

**Acceptance Criteria**
- Denied permission shows an explanation and a deep link to system settings
- Permanent denial is distinguished from a first-time prompt
- Returning from settings re-checks permission without an app restart
- An alternative path is offered where one exists, such as choosing an existing photo
- The state is covered by tests for each screen

---

## Issue 9: Measure and Budget Cold Start Performance
**Labels:** Mobile, performance, ci, tooling, devex
**Complexity:** Medium (150)

**Description**
Nothing measures how long the app takes to become usable from a cold start. Field devices are
typically low-end Android hardware, and a regression that adds seconds to startup would not be
noticed on a development machine.

**Acceptance Criteria**
- Cold start time to interactive is measured and reported
- A committed budget fails CI when exceeded beyond a tolerance
- Measurement targets a representative low-end device profile
- The report attributes time to identifiable startup phases
- Running the measurement locally is documented

---

## Issue 10: Add an End-to-End Test Harness for Core Field Flows
**Labels:** Mobile, testing, e2e, ci, reliability
**Complexity:** Hard (200)

**Description**
`app/mobile/src/__tests__/` holds unit tests, but no test drives the app as a user. The critical
field flows — scan, capture evidence, queue offline, sync when connectivity returns — span screens,
native permissions, and persistence, which is exactly what unit tests cannot cover.

**Acceptance Criteria**
- An end-to-end harness runs against a simulator or emulator in CI
- Scan, evidence capture, offline queue, and sync-on-reconnect are covered
- Airplane-mode and reconnect transitions are exercised
- Failures produce screenshots and logs as CI artifacts
- Running the suite locally is documented

---

## Issue 11: Localize the Mobile App
**Labels:** Mobile, i18n, ux, accessibility, product
**Complexity:** Hard (200)

**Description**
The web frontend is localized through `src/i18n.ts` and `src/messages/`, but the mobile app has
no equivalent and its strings are embedded in screens. Field workers are the users least likely to
work in the development team's language, so mobile arguably needs localization more than web does.

**Acceptance Criteria**
- A localization framework is in place with strings extracted from screens
- At least two locales are supported, matching those the web app offers
- Locale follows the device setting with an in-app override
- Dates, numbers, and currency are formatted per locale
- A CI check reports untranslated and hardcoded strings

---

## Issue 12: Consolidate API Retry and Backoff
**Labels:** Mobile, reliability, integration, architecture, performance
**Complexity:** Medium (150)

**Description**
`services/api.ts`, `aidApi.ts`, `taskApi.ts`, and `verificationApi.ts` each issue network
requests, and retry behaviour is implemented inconsistently across them. On the intermittent
connections these clients are designed for, inconsistent retries mean some calls give up too early
while others hammer a struggling backend.

**Acceptance Criteria**
- A single request layer implements retry, backoff, and jitter for all API clients
- Retries are limited to idempotent operations, with non-idempotent calls guarded by idempotency keys
- A total deadline bounds any request chain
- Retry attempts are observable in diagnostics
- Tests cover transient failure recovery and deadline expiry

---

## Issue 13: Consume Generated API Types in Mobile Clients
**Labels:** Mobile, devex, api, integration, tooling
**Complexity:** Medium (150)

**Description**
`app/mobile/src/types/` declares backend request and response shapes by hand, duplicating the
same definitions the web frontend maintains separately. Both copies drift from the backend
independently, and mobile drift is discovered latest because release cycles are slower.

**Acceptance Criteria**
- Mobile types are generated from the backend OpenAPI specification
- The aid, task, and verification clients consume generated types
- CI fails when committed generated types drift from the specification
- Hand-written duplicates are removed
- The generation command is shared with the frontend workflow

---

## Issue 14: Surface Data Staleness for Offline Content
**Labels:** Mobile, ux, reliability, data-model
**Complexity:** Trivial (100)

**Description**
`AidOverviewScreen.tsx`, `TaskListScreen.tsx`, and `AidDetailsScreen.tsx` render cached data
when offline without indicating its age. A field worker making a distribution decision cannot tell
whether they are looking at data from minutes ago or from several days ago.

**Acceptance Criteria**
- Cached content displays the age of the data it is showing
- Content beyond a configurable staleness threshold is visually flagged
- The indicator distinguishes offline-cached from freshly fetched data
- A manual refresh is available and reports success or failure
- The indicator honours the app's theme and accessibility settings

---

## Issue 15: Add Correlated Structured Logging for Field Diagnostics
**Labels:** Mobile, observability, devex, integration
**Complexity:** Medium (150)

**Description**
`HealthScreen.tsx` logs with bare `console.log` (for example line ~74). Diagnostics export was
added in Wave 7, but without structured, correlated logs the export cannot be joined to backend or
AI service traces, so a field-reported failure cannot be followed across services.

**Acceptance Criteria**
- A structured logger replaces ad-hoc console calls in services and screens
- Logs carry the correlation identifier used by backend requests
- Log level is configurable and defaults to a low-noise level in production
- Logs are size-bounded on device and included in the diagnostics export
- Sensitive values are redacted before being written

---
