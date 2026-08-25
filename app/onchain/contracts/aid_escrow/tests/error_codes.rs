#![cfg(test)]

use aid_escrow::Error;

#[test]
fn test_error_code_stability() {
    // This test ensures that error codes are not accidentally reordered, modified, or removed,
    // which would break clients relying on stable error discriminants.
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
}
