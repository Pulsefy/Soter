#![cfg(test)]

//! Guards the stable numeric discriminants of the contract `Error` enum.
//!
//! The backend adapter (`app/backend/src/onchain/utils/soroban-error.mapper.ts`)
//! maps contract failures to user-facing messages by these numeric codes.
//! Reordering or removing a variant would silently break that mapping, so this
//! test pins every variant to its canonical code. New variants MUST be appended
//! with the next unused code (see the compatibility policy in README.md).

use aid_escrow::Error;

#[test]
fn error_discriminants_are_stable() {
    // Every variant must map to its canonical, stable numeric code.
    assert_eq!(Error::NotInitialized as u32, 1);
    assert_eq!(Error::AlreadyInitialized as u32, 2);
    assert_eq!(Error::NotAuthorized as u32, 3);
    assert_eq!(Error::InvalidAmount as u32, 4);
    assert_eq!(Error::PackageNotFound as u32, 5);
    assert_eq!(Error::PackageNotActive as u32, 6);
    assert_eq!(Error::PackageExpired as u32, 7);
    assert_eq!(Error::PackageNotExpired as u32, 8);
    assert_eq!(Error::InsufficientFunds as u32, 9);
    assert_eq!(Error::PackageIdExists as u32, 10);
    assert_eq!(Error::InvalidState as u32, 11);
    assert_eq!(Error::MismatchedArrays as u32, 12);
    assert_eq!(Error::InsufficientSurplus as u32, 13);
    assert_eq!(Error::ContractPaused as u32, 14);
    assert_eq!(Error::ClaimTooEarly as u32, 15);
    assert_eq!(Error::InvalidProof as u32, 16);
    assert_eq!(Error::InvalidToken as u32, 17);
    assert_eq!(Error::TokenTransferFailed as u32, 18);
    assert_eq!(Error::NoPendingTransfer as u32, 19);
    assert_eq!(Error::InvalidPendingAdmin as u32, 20);
    assert_eq!(Error::BatchTooLarge as u32, 21);
    assert_eq!(Error::ClaimCooldownActive as u32, 22);
}

#[test]
fn error_discriminants_are_contiguous_and_unique() {
    // Collect all discriminants and verify they are unique and contiguous
    // starting at 1. This catches accidental duplicate or skipped codes.
    let mut codes: Vec<u32> = vec![
        Error::NotInitialized as u32,
        Error::AlreadyInitialized as u32,
        Error::NotAuthorized as u32,
        Error::InvalidAmount as u32,
        Error::PackageNotFound as u32,
        Error::PackageNotActive as u32,
        Error::PackageExpired as u32,
        Error::PackageNotExpired as u32,
        Error::InsufficientFunds as u32,
        Error::PackageIdExists as u32,
        Error::InvalidState as u32,
        Error::MismatchedArrays as u32,
        Error::InsufficientSurplus as u32,
        Error::ContractPaused as u32,
        Error::ClaimTooEarly as u32,
        Error::InvalidProof as u32,
        Error::InvalidToken as u32,
        Error::TokenTransferFailed as u32,
        Error::NoPendingTransfer as u32,
        Error::InvalidPendingAdmin as u32,
        Error::BatchTooLarge as u32,
        Error::ClaimCooldownActive as u32,
    ];
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(codes.len(), 22, "error codes must be unique");
    for (i, code) in codes.iter().enumerate() {
        assert_eq!(
            *code,
            (i + 1) as u32,
            "error codes must be contiguous from 1"
        );
    }
}
