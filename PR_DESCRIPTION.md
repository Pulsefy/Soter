# PR: Upgrade/Migration Test Harness

## Summary
This PR adds regression coverage for Aid Escrow contract upgrade and migration behavior.

## What changed
- Added migration progression tests covering a real version path from v1 to v2 to v3.
- Added state compatibility assertions to ensure migrations preserve core contract state:
  - contract version
  - admin identity
  - config values
  - pause state
- Added invalid-transition coverage so repeated or downgraded versions fail with a clear InvalidState error.

## Why
These tests make upgrade and migration rules explicit and help prevent regressions where state compatibility breaks across contract versions.

## Testing
- **Backend**: All backend lints pass (ESLint/Prettier), unit tests pass (Jest 48/48 suites, 467/467 tests).
- **Onchain**: Added/updated Rust contract tests in the Aid Escrow versioning suite.
  - Local Windows verification blocked: MSVC toolchain required for `cargo test` on Windows
  - Workaround: Run onchain tests on Linux CI (GitHub Actions) or with Visual Studio Build Tools installed
  - GNU Rust toolchain attempted but requires `liblto_plugin.dll` resolution or Admin MSVC install

## Notes
- Branch: feature/573-upgrade-migration-test-harness
- Commit: c3ca6c5
- **Status**: Backend CI passing. Onchain tests require non-Windows environment or MSVC Build Tools admin install.
