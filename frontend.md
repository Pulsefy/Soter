# Frontend Issues

## Wave 8

Wave 8 frontend work retires the remaining mock data layer, separates demo-only surfaces from
production builds, and adds the automated quality gates the app needs now that the major routes
exist. Wave 7 delivered live dashboard metrics, the activity center, WebAuthn biometrics, smoke
tests, and the theme audit; these issues build on that rather than revisiting it.

---

## Issue 1: Retire the Mock API Module From Production Code Paths
**Labels:** Frontend, chore, architecture, integration, api
**Complexity:** Hard (200)

**Description**
`app/frontend/src/lib/mock-api/` is still imported by production components, including
`src/app/[locale]/claim-receipt/page.tsx` and
`src/components/dashboard/AidDistributionMap.tsx`, both of which pull in `fetchClient` from the
mock module. Individual screens were migrated to live data in earlier waves, but the module itself
remains reachable from shipped code, so it is unclear which surfaces are real.

Complete the migration and confine mock data to development and test only.

**Acceptance Criteria**
- No file under `src/app` or `src/components` imports from `lib/mock-api` in a production build
- Remaining consumers are migrated to the real API clients in `lib/verification-api.ts` and siblings
- Mock data remains available for tests and for `NEXT_PUBLIC_USE_MOCKS` development mode
- A lint rule or CI check prevents new production imports of the mock module
- Behaviour with mocks disabled is verified for each migrated screen

---

## Issue 2: Exclude Demo-Only Routes From Production Builds
**Labels:** Frontend, security, chore, config, devex
**Complexity:** Medium (150)

**Description**
The route tree under `src/app/[locale]/` includes `demo-version`, `demo-checklist`, and
`admin-biometric-demo`. The last of these states in its own copy that it is a mock implementation
and documents the environment variables that drive it. These routes are useful for contributors but
should not be reachable in a production deployment.

**Acceptance Criteria**
- Demo routes are excluded from production builds or gated behind an explicit flag
- Requests to a gated route in production return a 404 rather than rendering
- The routes remain fully available in development and preview environments
- Navigation and sitemap entries do not reference gated routes in production
- The gating mechanism is documented for contributors adding future demo routes

---

## Issue 3: Detect Missing Translation Keys in CI
**Labels:** Frontend, i18n, ci, devex, testing
**Complexity:** Medium (150)

**Description**
The app is localized through `src/i18n.ts`, `src/messages/`, and the `[locale]` route segment,
but nothing verifies that every locale defines every key. A missing key currently surfaces to users
as a raw identifier, and only in the locale nobody on the team is testing.

**Acceptance Criteria**
- A CI check compares each locale's key set against the reference locale
- Missing and orphaned keys both fail the check with a listing
- Hardcoded user-facing strings in components are reported
- The check runs on pull requests touching frontend files
- The process for adding a new locale is documented

---

## Issue 4: Enforce a Bundle Size Budget
**Labels:** Frontend, performance, ci, tooling, devex
**Complexity:** Medium (150)

**Description**
The frontend spans roughly 150 source files and pulls in maps, charts, wallet libraries, and
Stellar SDK code. Nothing measures the shipped bundle, so a heavy import added to a shared layout
degrades load time for every route without anyone noticing until it is in production.

**Acceptance Criteria**
- Per-route JavaScript budgets are committed
- CI fails when a budget is exceeded beyond a stated tolerance
- The failure message names the route and the largest contributing modules
- Budgets can be raised deliberately in a reviewed commit
- Heaviest current routes are documented as a starting baseline

---

## Issue 5: Add Automated Accessibility Checks to CI
**Labels:** Frontend, accessibility, ci, testing, ux
**Complexity:** Medium (150)

**Description**
`docs/accessibility.md` and `src/app/theme-contrast.test.ts` capture the manual contrast work
completed earlier, but there is no automated check for structural accessibility problems such as
missing labels, invalid ARIA, or unreachable interactive elements. Regressions are only caught by
manual review.

**Acceptance Criteria**
- An automated accessibility scan runs against the main routes in CI
- Violations above a configured severity fail the build
- Existing known issues are recorded as an explicit baseline rather than blocking adoption
- The report names the rule, the element, and the route
- Running the scan locally is documented

---

## Issue 6: Add Route-Level Loading States
**Labels:** Frontend, ux, performance, reliability
**Complexity:** Medium (150)

**Description**
Routes under `src/app/[locale]/` fetch data on mount, but most render nothing meaningful while
that request is outstanding. On a slow field connection the dashboard, campaigns, and
verification-review routes appear broken rather than loading.

**Acceptance Criteria**
- Each primary route provides a loading state that reflects its eventual layout
- Loading states preserve layout dimensions to avoid content shift
- Slow loads surface a secondary message rather than an indefinite spinner
- Loading states respect the active theme and reduced-motion preferences
- The pattern is documented so new routes adopt it consistently

---

## Issue 7: Apply Optimistic Updates With Rollback to Review Actions
**Labels:** Frontend, ux, performance, workflow, reliability
**Complexity:** Hard (200)

**Description**
The verification review flow in `src/app/[locale]/verification-review/` and
`src/components/verification-review/` waits for a full server round trip before reflecting an
approve or reject. Reviewers working through a queue experience a stall on every decision, which is
the single most repeated interaction in the app.

**Acceptance Criteria**
- Approve and reject apply immediately in the UI before confirmation
- A failed request rolls the item back and explains what happened
- The queue cannot be advanced into an inconsistent state by rapid successive actions
- Concurrent modification by another reviewer is detected and surfaced
- Tests cover success, failure rollback, and rapid sequential actions

---

## Issue 8: Report Client Errors to the Backend
**Labels:** Frontend, observability, reliability, ops, integration
**Complexity:** Medium (150)

**Description**
`src/components/ErrorBoundary.tsx`, `src/app/error.tsx`, and `src/app/global-error.tsx` catch
render failures and show a recovery surface, but nothing is reported anywhere. A crash affecting
every user of a route is invisible unless a user reports it manually.

**Acceptance Criteria**
- Caught errors are reported to a backend endpoint with route, message, and stack
- Reports include the correlation identifier used by the backend
- Personally identifiable form values are stripped before sending
- Reporting failures never surface to the user or cause a loop
- Reporting can be disabled by configuration

---

## Issue 9: Warn Before Session Expiry and Refresh Silently
**Labels:** Frontend, ux, auth, reliability, security
**Complexity:** Medium (150)

**Description**
Authenticated sessions expire with no warning. A reviewer part-way through an evidence decision or
a long campaign form loses their work and is returned to sign-in with no explanation, which is both
a data loss and a trust problem.

**Acceptance Criteria**
- Users are warned before expiry with an option to extend
- Sessions refresh silently while the user is active
- Unsaved work in progress is preserved across a refresh
- Genuine expiry explains what happened and returns the user to their prior location after sign-in
- Concurrent tabs do not each trigger separate refreshes

---

## Issue 10: Support API Key Rotation in the Admin UI
**Labels:** Frontend, admin, security, ux, api
**Complexity:** Medium (150)

**Description**
`src/components/AdminApiKeyManager.tsx` creates and revokes keys but offers no rotation. Once the
backend supports overlap-window rotation, operators need a UI that makes the safe path obvious
rather than encouraging revoke-then-create, which causes downtime.

**Acceptance Criteria**
- An operator can rotate a key and see both the successor and the remaining grace window
- The new secret is shown exactly once with an explicit copy affordance
- Scope changes during rotation are surfaced before confirmation
- Expiring and expired keys are visually distinguished
- The flow explains what will happen before the operator commits

---

## Issue 11: Make the Review Queue Fully Keyboard Operable
**Labels:** Frontend, accessibility, ux, workflow
**Complexity:** Medium (150)

**Description**
The verification review queue is a high-volume, repetitive interface where a reviewer processes
many items in sequence. It currently requires pointer interaction for the core decisions, which is
slower for expert users and a genuine barrier for keyboard and assistive technology users.

**Acceptance Criteria**
- Queue navigation, approve, reject, and detail expansion are reachable by keyboard
- Focus moves predictably to the next item after a decision
- Shortcuts are discoverable in the UI and do not conflict with assistive technology
- Focus is never trapped or lost when items are removed from the queue
- Decisions are announced to screen readers

---

## Issue 12: Consume Generated API Types Instead of Hand-Written Ones
**Labels:** Frontend, devex, api, integration, tooling
**Complexity:** Medium (150)

**Description**
`src/types/`, `src/lib/verification-api.ts`, and `src/lib/verification-inbox-api.ts` declare
request and response shapes by hand. These drift from the backend whenever a DTO changes, and the
drift is discovered at runtime rather than at compile time.

**Acceptance Criteria**
- Types are generated from the backend OpenAPI specification
- At least the verification, claims, and campaigns clients consume generated types
- CI fails when committed generated types drift from the specification
- The generation command is documented
- Hand-written duplicates of generated types are removed

---

## Issue 13: Move Table Pagination to the Server
**Labels:** Frontend, performance, api, integration, ux
**Complexity:** Hard (200)

**Description**
`src/components/AidPackageList.tsx`, `src/components/Pagination.tsx`, and the dashboard tables
paginate client-side over a full result set. As package and claim volume grows this transfers and
renders data the user never sees, and the dashboard becomes the slowest route in the app.

**Acceptance Criteria**
- List endpoints are called with page, size, and sort parameters
- Filters and sorting are applied server-side and reflected in the URL
- Total counts come from the server rather than the loaded array length
- Rapid page changes do not render stale responses out of order
- Behaviour is verified against a dataset large enough to expose the difference

---

## Issue 14: Keep the Distribution Map Responsive at Scale
**Labels:** Frontend, performance, ux, analytics
**Complexity:** Medium (150)

**Description**
`src/components/dashboard/AidDistributionMap.tsx` renders distribution points with clustering,
popups, and filters. Marker handling is not bounded, so a campaign with a large number of points
degrades pan and zoom to the point the map is unusable — and this only appears with real data volume.

**Acceptance Criteria**
- Rendering stays interactive at a documented target marker count
- Off-viewport markers are not rendered
- Clustering thresholds are tuned and configurable
- Filter changes do not rebuild the entire marker layer
- Performance is measured before and after against a large fixture

---

## Issue 15: Render Localized Messages From Backend Error Codes
**Labels:** Frontend, ux, i18n, api, integration
**Complexity:** Medium (150)

**Description**
`src/lib/error-utils.ts` derives user-facing text from HTTP status and server message strings.
Because the copy comes from the backend it cannot be localized, and it changes whenever a backend
message is reworded. Once the backend publishes stable error codes, the frontend should map codes to
its own translated copy.

**Acceptance Criteria**
- Error handling keys off the backend error code rather than the message text
- Each known code maps to a localized message in `src/messages/`
- Unknown codes fall back to a generic localized message and are reported
- The correlation identifier remains available for support
- Tests cover known codes, unknown codes, and network failure

---
