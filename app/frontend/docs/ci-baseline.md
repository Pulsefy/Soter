# Frontend CI baseline

Status of the four frontend gates enforced by
[`.github/workflows/frontend-quality.yml`](../../../.github/workflows/frontend-quality.yml).
Recorded so the workflow could be enabled without blocking every PR on
pre-existing debt, and so the remaining work has a home.

Last updated: 2026-09-28 — all four gates green on
`ci/frontend-lint-typecheck-test-build`.

## Baseline summary

| Gate | Command | Baseline on `main` | Current | Required check |
| --- | --- | --- | --- | --- |
| Lint | `pnpm lint` | ❌ 55 errors / 24 warnings | ✅ clean | **yes** |
| Type check | `pnpm type-check` (`tsc --noEmit`) | ✅ clean | ✅ clean | **yes** |
| Unit tests | `pnpm test` | ❌ 3 suites / 28 tests failing | ✅ 40 suites / 408 tests | **yes** |
| Build | `pnpm build` (`next build`) | ✅ clean | ✅ clean | **yes** |

All gates are now blocking: the `continue-on-error: true` flags on the `lint`
and `test` jobs have been removed, so the jobs fail the run on regression.
Add all four jobs to branch-protection required checks (see
[Enabling the checks](#enabling-the-checks)).

## Fixed by the enabling change

These were blockers for `Build` / `Type check` and are **not** outstanding:

- **Duplicate route handler** — `src/middleware.ts` and `src/proxy.ts` both
  existed. Next.js 16 only allows `proxy.ts`, so every build failed with
  *“Both middleware file … and proxy file … are detected”*. `middleware.ts` was
  removed; `proxy.ts` already contained the same demo-route guard plus the
  next-intl middleware.
- **Missing test peer dependency** — `@testing-library/dom` (a required peer of
  `@testing-library/react` v16) was not declared, so component/integration suites
  could not resolve the DOM toolkit. Now declared explicitly.
- **Test environment** — the Jest default was the `node` environment with
  per-file jsdom opt-ins. Added `jest.environment.ts`, a jsdom environment that
  bridges the fetch/text primitives jsdom omits, plus `jest.setup.ts` for the
  global `@testing-library/jest-dom` matchers and the jsdom docblock where a DOM
  is required. This recovered 5 of the 8 previously-failing suites.
- **Real type errors surfaced by `tsc`** (all resolved):
  - `ImportRecipientsWizard.tsx` referenced an undeclared `tErrors` translator.
  - `AidDistributionMap.tsx` referenced a `normalizePoint` helper and a
    `DistributionMapFilters` type that a refactor dropped.
  - `apiKeyService.ts` / `adminService.ts` disagreed with their callers: the
    rotate endpoint returned `void` while the UI expected `{ newSecret }`, and
    `ApiKey` was missing the `keyHint`/`status` fields the table renders.
  - `src/lib/mock-api/api-client.ts` + `verification-inbox-api.ts` imported
    `openapi-fetch` (never installed) and `@/types/generated/api` (never
    generated for the frontend). Nothing imported them — dead code, deleted.
- **Infinite render loop** — `useVersion().loadVersionConfig` was re-created on
  every render, so `VersionProvider`’s effect re-ran forever (it also ran the
  test runner out of memory). Now wrapped in `useCallback`.

## Outstanding — none

The pre-existing lint debt (55 errors / 24 warnings) and the three failing test
suites described in earlier revisions of this document were resolved on the
`ci/frontend-lint-typecheck-test-build` branch:

- **Lint (0 errors / 0 warnings)** — replaced `any`s in `jobStatusClient.ts`
  (and the verification flows, faucet helper and `i18n.ts`) with proper payload
  types; fixed unescaped entities in `VersionDemo.tsx` / `ReleaseNotesModal.tsx`
  and `i18n.ts`'s `includes` cast; converted
  `verify-biometric-implementation.js` to an ESM `.mjs` script; removed unused
  imports/variables; added the missing `toast`/`tErrors` effect deps; swapped
  the evidence `<img>` for an unoptimized `next/image`.
- **`react-hooks/set-state-in-effect` (6 errors)** — restructured the fetch
  effects in `AdminApiKeyManager`, `DeviceDiagnosticsExport`,
  `TestnetFaucetHelper`, `VersionProvider`, `claim-receipt` and
  `demo-checklist` to the canonical effect-local async-function pattern
  (react.dev), deriving state during render instead of mirroring it in effects.
- **Unit tests (40 suites / 408 tests)** — the Verification Inbox list/detail
  handlers were restored in `mock-api/handlers.ts`, the biometric WebAuthn
  fixtures updated to the service's current control flow, and the version
  integration suite now mocks the version service and uses tightened queries.
- **Regression fixed along the way** — a CRLF rewrite in `55c05ae` had dropped
  the `<TestnetFaucetHelper />` render (but not its import) from `app/layout.tsx`;
  it is mounted again, hiding the unused-import warning and restoring the
  testnet-only helper to the app shell.

## Enabling the checks

1. ~~Fix the outstanding lint and test items above.~~ done
2. ~~Delete `continue-on-error: true` from the `lint` and `test` jobs in
   `.github/workflows/frontend-quality.yml`.~~ done
3. In GitHub → **Settings → Branches → Branch protection rules → main → Require
   status checks to pass**, add:
   - `Frontend Quality / Type check`
   - `Frontend Quality / Build`
   - `Frontend Quality / Lint`
   - `Frontend Quality / Unit tests`
4. ~~Update the summary table in this document.~~ done
