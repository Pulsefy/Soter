# Aid Escrow Backend Coverage

This inventory records whether the production backend adapter directly invokes
each public `aid_escrow` contract function. It reflects the Soroban adapter
selected by `ONCHAIN_ADAPTER=soroban` in
`app/backend/src/onchain/soroban.adapter.ts`. Adapter methods that call another
contract, use an RPC method, return a placeholder, or derive a value from a
different AidEscrow call do not count as direct coverage.

The contract source and checked-in Soroban ABI currently expose **71 public
functions**. The count is based on `#[contractimpl]` in `src/lib.rs` and the
`functions` in `app/backend/src/onchain/contract-interface/aid-escrow.contract.json`.

| Contract function | Backend status | Reason |
|---|---|---|
| `init` | Wired | `initEscrow` submits the contract initialization call. |
| `get_admin` | Intentionally not wired | Admin ownership is monitored through contract operations tooling, not the application API. |
| `get_pending_admin` | Intentionally not wired | Pending ownership transfers are monitored through contract operations tooling. |
| `transfer_admin` | Intentionally not wired | Ownership changes are a contract-operator action and are not proxied by the application backend. |
| `accept_admin` | Intentionally not wired | The pending admin must accept ownership through an operator-controlled transaction. |
| `cancel_admin_transfer` | Intentionally not wired | Cancelling an ownership transfer remains an operator-controlled contract action. |
| `get_version` | Wired | `getContractMetadata` reads the contract version through this entrypoint. |
| `contract_version` | Not wired | The backend metadata method currently reads numeric storage version with `get_version`, not this semantic package version. |
| `migrate` | Intentionally not wired | Contract upgrades and storage migrations are performed through audited operator tooling. |
| `add_distributor` | Intentionally not wired | Distributor permissions are managed by contract operators, outside application request flows. |
| `remove_distributor` | Intentionally not wired | Distributor permissions are managed by contract operators, outside application request flows. |
| `get_distributor_count` | Not wired | The backend has no distributor administration or reporting consumer for this count. |
| `is_distributor` | Not wired | No backend authorization or product flow currently queries distributor membership on-chain. |
| `list_distributors` | Not wired | The backend has no distributor administration or reporting endpoint. |
| `get_max_distributors` | Not wired | The backend does not expose distributor-capacity configuration. |
| `set_max_distributors` | Intentionally not wired | Changing the distributor cap is contract administration handled by operators. |
| `set_config` | Intentionally not wired | Contract-wide configuration changes are restricted to audited operator actions. |
| `pause` | Intentionally not wired | Global emergency pausing is an operator control and is not exposed through the application API. |
| `unpause` | Intentionally not wired | Global emergency unpausing is an operator control and is not exposed through the application API. |
| `pause_action` | Intentionally not wired | Action-level emergency controls are reserved for contract operators. |
| `unpause_action` | Intentionally not wired | Action-level emergency controls are reserved for contract operators. |
| `is_action_paused` | Not wired | The application currently exposes only the global pause state, not per-action pause status. |
| `is_paused` | Wired | `getPauseState` reads the global pause state through this entrypoint. |
| `pause_campaign` | Intentionally not wired | Campaign emergency controls are reserved for contract operators. |
| `unpause_campaign` | Intentionally not wired | Campaign emergency controls are reserved for contract operators. |
| `is_campaign_paused` | Not wired | No backend campaign status endpoint currently queries campaign pause state. |
| `get_config` | Not wired | No backend flow reads the contract configuration; the current fee-config method is a placeholder. |
| `fund` | Intentionally not wired | The funder's own authorization is required, so funding must be submitted from the funder's wallet. |
| `create_package` | Wired | `createAidPackage` submits package creation through this entrypoint. |
| `batch_create_packages` | Wired | `batchCreateAidPackages` submits batch creation through this entrypoint. |
| `claim` | Wired | `claimAidPackage` submits a standard package claim through this entrypoint. |
| `claim_with_proof` | Not wired | The backend claim API has no Merkle proof input or proof-verification flow. |
| `claim_with_relayer` | Not wired | The backend has no relayer claim flow or relayer authorization handling. |
| `batch_claim` | Not wired | No backend API or adapter method submits recipient claims in batches. |
| `disburse` | Wired | `disburseAidPackage` submits admin disbursement through this entrypoint. |
| `reassign_package` | Not wired | No backend service or endpoint currently supports recipient reassignment. |
| `batch_revoke` | Not wired | No backend API or adapter method submits batch revocations. |
| `batch_refund` | Not wired | Batch refunds are explicitly listed as a future backend enhancement in `SOROBAN_INTEGRATION.md`. |
| `revoke` | Not wired | No backend service or endpoint currently supports package revocation. |
| `refund` | Not wired | No backend service or endpoint currently supports package refunds. |
| `cancel_package` | Not wired | No backend service or endpoint currently supports package cancellation. |
| `attach_evidence_hash` | Not wired | The backend has no operation for attaching an evidence hash after package creation. |
| `extend_expiration` | Intentionally not wired | This deprecated relative-time entrypoint is superseded by the adapter's absolute-time `extend_expiry` call. |
| `extend_expiry` | Wired | `extendAidPackageExpiry` submits the canonical absolute-expiry update through this entrypoint. |
| `propose_surplus_withdrawal` | Intentionally not wired | Surplus withdrawals are timelocked treasury actions handled by contract operators. |
| `cancel_surplus_withdrawal` | Intentionally not wired | Cancelling a surplus withdrawal is part of operator-controlled treasury management. |
| `execute_surplus_withdrawal` | Intentionally not wired | Executing a timelocked surplus withdrawal is an operator-controlled treasury action. |
| `get_pending_withdrawal` | Intentionally not wired | Pending treasury withdrawals are monitored through contract operations tooling, not the application API. |
| `get_total_locked` | Not wired | No backend endpoint currently exposes the per-token locked total. |
| `get_total_claimed` | Not wired | No backend endpoint currently exposes the per-token claimed total. |
| `get_campaign_token_locked` | Not wired | No backend campaign reporting endpoint currently reads locked token totals. |
| `get_campaign_token_claimed` | Not wired | No backend campaign reporting endpoint currently reads claimed token totals. |
| `get_package` | Wired | `getAidPackage` reads package details through this entrypoint. |
| `view_package_status` | Not wired | No dedicated status-polling adapter method exists; current package reads use `get_package`. |
| `get_evidence_hash` | Not wired | No backend endpoint currently reads the package evidence hash. |
| `get_aggregates` | Wired | `getAidPackageCount` reads token aggregates through this entrypoint. |
| `get_campaign_package_count` | Not wired | No backend campaign reporting endpoint currently reads package counts. |
| `get_campaign_claim_count` | Not wired | No backend campaign reporting endpoint currently reads claim counts. |
| `get_recipient_package_count` | Not wired | The read service currently falls back to zero; paginated recipient listing is a documented future enhancement. |
| `list_recipient_packages` | Not wired | Pagination is a documented future enhancement, but the production adapter has no implementation and the read service returns an empty page. |
| `set_delegate` | Not wired | No backend service or endpoint currently supports setting a package delegate. |
| `set_delegate_with_expiry` | Not wired | No backend service or endpoint currently supports setting a delegate expiry. |
| `revoke_delegate` | Not wired | No backend service or endpoint currently supports revoking a package delegate. |
| `get_delegate` | Not wired | No backend endpoint currently exposes package delegate information. |
| `get_delegate_info` | Not wired | No backend endpoint currently exposes delegate details or expiry. |
| `get_delegate_history` | Not wired | No backend endpoint currently exposes delegate history. |
| `add_allowed_token` | Intentionally not wired | Token allowlist changes are contract administration handled by operators. |
| `remove_allowed_token` | Intentionally not wired | Token allowlist changes are contract administration handled by operators. |
| `cleanup_expired_delegates` | Not wired | No backend maintenance job currently invokes the admin-authorized delegate cleanup. |
| `sweep_expired_delegates` | Not wired | No backend maintenance job currently invokes the permissionless delegate sweep. |
| `sweep_expired_packages` | Not wired | No backend maintenance job currently invokes the permissionless package sweep. |

## Keeping this inventory current

When wiring another contract function, update this table in the same change:

1. Add or change its row to `Wired` and name the adapter method and contract
   entrypoint in the reason.
2. If adding a contract public function, add its row and status as part of the
   same change that updates `src/lib.rs` and the checked-in Soroban ABI.
3. If changing a non-wired decision, update the status and reason when the
   backend route, authorization boundary, or operator workflow changes.
4. Reconcile the table against every function in the contract's
   `#[contractimpl]` and the `functions` list in
   `app/backend/src/onchain/contract-interface/aid-escrow.contract.json` before
   merging.
