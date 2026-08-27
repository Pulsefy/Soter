# Audit Log Tamper Evidence

## Scheme Overview
To ensure the integrity of security-relevant actions, the Audit Log uses a tamper-evident hash chain scheme. This is critical for humanitarian aid systems to detect unauthorized modification or deletion of history.

Each time an `AuditLog` entry is created:
1. It looks up the `hash` of the most recently inserted log.
2. It generates a new SHA-256 hash that covers its own content (actor, entity, action, metadata) as well as the previous entry's hash.
3. The new entry stores both its own computed `hash` and the `previousHash`.

## Verification
A verification routine (`GET /audit/verify` admin endpoint) recalculates the hashes of the entire log chain in chronological order. It detects:
- **Mutation**: If an entry's content is changed, its newly computed hash will not match the stored `hash`.
- **Deletion/Insertion**: If an entry is removed or silently inserted, the subsequent entry's `previousHash` will no longer match the expected chain sequence.

## Limits and Caveats
While this scheme detects tampering, it has the following limitations:
- **Concurrency**: High concurrency during log insertion could result in two entries attempting to use the same `previousHash`, causing a fork in the chain if strict isolation isn't enforced. For now, it relies on application-level serialization in the transaction.
- **Root Trust**: If an attacker gains full access to the database *and* the application code, they could theoretically recalculate the entire hash chain from scratch (a complete rewrite of history). The scheme relies on the application being the sole authority for writing logs.
- **Rollback**: If the last entry in the chain is deleted, the chain will still appear perfectly valid (truncation attack), unless an external system monitors the chain's length or last known hash.
