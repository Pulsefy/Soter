# Onchain Admin Action Logging

Onchain administrative operations use `AdminActionLogger` so their tamper-evident audit entries have one typed schema, safe failure classification, and consistent outcome severity. New admin routes must use this helper rather than constructing an independent audit event.

## Event schema

Each entry represents these fields in the `AuditLog` columns and structured metadata:

| Field | Meaning |
| --- | --- |
| `actor` | Authenticated subject, user ID, API-key ID, or address; `unknown` only when authentication context supplies none. |
| `action` | Stable operation identifier, such as `aid_package.delegate.set`. |
| `target` | `{ type, id }` for the affected contract, package, ledger range, or configuration; `null` if unavailable. |
| `before` | Safe relevant state read before the mutation, or `null` when unavailable/inapplicable. |
| `after` | Safe resulting state, recorded only after success; `null` for failures or when inapplicable. |
| `correlationId` | Existing request/operation ID, or `null` outside a correlated request. |
| `outcome` | `success`, `rejected`, or `failed`. |
| `severity` | `info` for success, `warn` for rejected 4xx operations, and `error` for unexpected failures/5xx outcomes. |
| `error` | Safe classification code only; never the raw exception message. |
| `details` | Optional allowlisted operation metadata, such as a confirmed transaction hash. |

`actor`, `action`, and `target` are also mapped to the existing audit columns (`actorId`, `action`, `entity`/`entityId`). The remaining fields are stored as structured JSON metadata, not folded into the action message. Unavailable state is represented as `null`; callers must not infer or fabricate it.

## Wiring and use

`AdminActionLogger` is exported by the global `AuditModule` and injected like other Nest services. Controllers should resolve the actor and correlation with `getAdminActionActor` and `getAdminActionCorrelationId` from `admin-action-logger.service.ts`. The latter reuses the middleware's `correlationId`, `requestId`, or incoming correlation headers and does not generate a replacement.

Use `execute` to wrap the complete operation, including relevant state reads and validation. It records success only after the operation returns and the success predicate passes. A thrown `HttpException` becomes `rejected` for 4xx or `failed` for 5xx; other exceptions become `failed` with `UNEXPECTED_ERROR`. Explicit transaction result failures should be passed through the success predicate. The audit sink is fail-closed: a failed audit append propagates to the caller, consistent with `AuditService`'s tamper-evident audit guarantee.

```ts
let previousDelegate: {
  delegateAddress?: string;
  expiresAt?: number;
} | null = null;
const params = {
  adminAddress,
  packageId,
  delegateAddress,
  expiresAt,
};

const result = await this.adminActionLogger.execute(
  {
    actor: actorId,
    action: 'set_delegate',
    target: { type: 'aid_package', id: packageId },
    before: () => previousDelegate,
    correlationId,
  },
  async () => {
    previousDelegate = await this.onchainAdapter.getDelegate({ packageId });
    return this.onchainAdapter.setDelegate(params);
  },
  async value => {
    if (value.status !== 'success') return null;
    const state = await this.onchainAdapter.getDelegate({ packageId });
    return {
      delegateAddress: state.delegateAddress ?? null,
      expiresAt: state.expiresAt ?? null,
    };
  },
  value => value.status === 'success',
);
```

Keep snapshots limited to fields needed to explain the state change. The helper filters credential-like keys (including secrets, tokens, passwords, private keys, headers, and payload fields) from state objects, but callers must still avoid passing entire request, configuration, or adapter objects. Never log secret keys, access tokens, authentication headers, credentials, or sensitive request payloads. Prefer stable identifiers and a safe error code; do not put exception messages into audit metadata.

## Testing new actions

Test the observable `AuditService.record` entry for the authenticated actor, stable action, target, preserved correlation ID, state snapshots, and outcome severity. Cover a thrown/rejected operation and a returned transaction status of `failed`; both must have `after: null` and must not be labeled successful. Verify unauthorized requests never invoke the operation, and verify audit sink failures propagate rather than being silently swallowed. Use the existing focused specs in `src/audit/admin-action-logger.service.spec.ts` and `src/onchain/aid-escrow.admin-actions.spec.ts` as examples.