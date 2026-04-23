# Legacy Tests

This folder contains tests for legacy contract functionality that is no longer used in the current application design.

These tests reference outdated methods and design patterns that have been superseded by the current AidEscrow implementation.

The current application uses:
- `init` - Initialize contract
- `create_package` - Create aid packages
- `disburse` - Admin disbursement

Legacy methods not used in current flow:
- `fund` - Funding the contract pool
- `claim` - Recipient self-claim
- `revoke` - Cancel packages
- `refund` - Withdraw expired/cancelled funds