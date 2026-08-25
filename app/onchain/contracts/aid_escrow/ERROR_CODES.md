# Contract Error Codes

This document lists the stable error codes returned by the Aid Escrow contract.
To ensure compatibility with clients, these codes must not be reordered or removed.

## Compatibility Policy

1. **Never reorder variants**: Once an error code is assigned and deployed, its numeric discriminant is permanently reserved.
2. **Never remove variants**: Deprecated variants should be kept (or renamed to indicate deprecation) so that the numbering remains contiguous and historical transaction parses remain valid.
3. **Adding new variants**: Always append new variants with the next available explicit discriminator (e.g., `NewError = 22`).
4. **Enforcement**: Any changes to error enumerations are guarded by automated tests that assert the discriminants.

## Reference Table

| Code | Name | Meaning / Description |
| ---- | ---- | --------------------- |
| 1 | `NotInitialized` | The contract has not been initialized yet. |
| 2 | `AlreadyInitialized` | The contract is already initialized. |
| 3 | `NotAuthorized` | The caller lacks authorization for this action. |
| 4 | `InvalidAmount` | The provided amount is invalid (e.g., zero or negative). |
| 5 | `PackageNotFound` | The requested aid package could not be found. |
| 6 | `PackageNotActive` | The package is not in an active state. |
| 7 | `PackageExpired` | The package has expired and can no longer be used. |
| 8 | `PackageNotExpired` | The action requires the package to be expired, but it is not. |
| 9 | `InsufficientFunds` | There are insufficient funds to complete the action. |
| 10 | `PackageIdExists` | An aid package with the given ID already exists. |
| 11 | `InvalidState` | The contract or package is in an invalid state for this operation. |
| 12 | `MismatchedArrays` | Provided arrays (e.g., recipients and amounts) have different lengths. |
| 13 | `InsufficientSurplus` | Insufficient surplus exists for withdrawal. |
| 14 | `ContractPaused` | The contract is currently paused. |
| 15 | `ClaimTooEarly` | An attempt was made to claim before allowed. |
| 16 | `InvalidProof` | A provided proof is invalid. |
| 17 | `InvalidToken` | The token used is invalid or unsupported. |
| 18 | `TokenTransferFailed` | A token transfer operation failed. |
| 19 | `NoPendingTransfer` | There is no pending transfer to process. |
| 20 | `InvalidPendingAdmin` | The pending admin is invalid. |
| 21 | `BatchTooLarge` | The batch size exceeds the allowed limit. |
