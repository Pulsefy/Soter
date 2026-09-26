# Audit Log Integrity: Tamper-Evident Hash Chain

Soter's `AuditLog` records security-relevant actions (claims, escrows,
verification decisions, evidence handling, key policy changes). Because the
audit trail exists to prove what happened — not merely to display it — every
entry is now part of a **tamper-evident hash chain**: each entry cryptographically
covers its own content *and* the hash of the previous entry.

This document describes the scheme, how to verify it, and — just as
importantly — what it does **not** protect against.

---

## 1. Data model

Four nullable columns were added to the `AuditLog` table
(`prisma/migrations/20260924000000_audit_log_hash_chain`):

| Column              | Type     | Purpose                                                            |
| ------------------- | -------- | ------------------------------------------------------------------ |
| `sequence`          | `BigInt` | Strictly increasing chain position. Unique index.                  |
| `prevHash`          | `Text`   | Hash of the previous entry; `GENESIS_PREV_HASH` for the first one. |
| `entryHash`         | `Text`   | SHA-256 over the entry content and `prevHash`.                     |
| `metadataCanonical` | `Text`   | Canonical JSON serialization of `metadata`, covered by the hash.   |

Rows that predate the chain keep all four fields `null` ("legacy" rows) until
they are sealed by the backfill routine (§5).

### 1.1 Hash computation

The entry hash is defined in `src/audit/audit-chain.util.ts`
(`computeEntryHash`). It is the SHA-256 of a JSON array payload:

```json
[
  "soter-audit-v1",
  "<id>",
  "<sequence>",
  "<prevHash>",
  "<actorId>",
  "<entity>",
  "<entityId>",
  "<action>",
  "<timestamp ISO-8601>",
  "<sha256(metadataCanonical)>"
]
```

Design notes:

- **Domain separation** — the leading `"soter-audit-v1"` string makes the
  payload unambiguous and versionable. A format change can bump the version
  instead of silently invalidating old chains.
- **Length-delimited encoding** — a JSON array is used instead of string
  concatenation, so there are no separator ambiguities between field values.
- **Metadata is hashed, not embedded** — the metadata (which can be large) is
  folded in via its SHA-256 digest. The *canonical* serialization is stored
  alongside the raw JSON column so the exact bytes that were hashed are
  reconstructible even though Postgres `jsonb` does not preserve key order.
- **Canonical JSON** — `metadataCanonical` is produced by recursively sorting
  object keys and pretty-printing, so two logically equal objects always hash
  identically regardless of key insertion order.
- **`prevHash` is raw hex** — it is mixed in unescaped, matching how it
  appears in the database.
- **`GENESIS_PREV_HASH`** is 64 ASCII zeroes and marks the first entry of the
  chain.

### 1.2 The chain at a glance

```
seq 1:  entryHash₁ = H(content₁, prevHash = 000...0)
seq 2:  entryHash₂ = H(content₂, prevHash = entryHash₁)
seq 3:  entryHash₃ = H(content₃, prevHash = entryHash₂)
...
```

Altering any field of entry *n* changes `entryHashₙ`, which makes the
`prevHash` recorded on entry *n+1* invalid: the damage propagates forward and
is detected by the verifier.

---

## 2. Writing: how appends are serialized

`AuditChainService.appendToChain` (used by `AuditService.record`, the single
write path for audit entries) appends each entry inside an interactive
transaction that takes a **Postgres advisory lock**
(`pg_advisory_xact_lock`). Within that lock it:

1. Reads the current chain head (highest `sequence` with an `entryHash`).
2. Assigns `sequence = head + 1` and `prevHash = head.entryHash`
   (or genesis when the chain is empty).
3. Inserts the row; the database generates the final `id` and `timestamp`.
4. Computes `entryHash` over the **final** row content and persists it with a
   second statement in the same transaction.

Consequences:

- Two concurrent appends can never observe the same head: sequences are
  strictly increasing and every `prevHash` is a hash that was, at some point,
  the true head.
- No intermediate hash value is ever visible outside the transaction: readers
  never see a sealed row with a hash that was computed over a pre-final id or
  timestamp.

---

## 3. Verification

`AuditChainService.verifyChain()` walks all sealed rows in `sequence` order
(paged, 1000 rows per page) and for each entry:

1. **Recomputes the hash** from the stored canonical metadata and compares it
   to the stored `entryHash` → detects **content mutation**.
2. **Checks the link**: the stored `prevHash` must equal the previous sealed
   entry's hash (or genesis for the first entry) → detects **middle insertion
   and deletion**.
3. **Cross-checks metadata**: the visible `metadata` JSON must be logically
   equal to `metadataCanonical` (order-insensitive comparison, since `jsonb`
   reorders keys) → detects a raw rewrite of the JSON column that skipped the
   canonical field.

The first surviving entry must link to the genesis hash, so **deletion at the
head of the chain** (removal of entry 1) is also detected.

Legacy (unsealed, `entryHash = null`) rows cannot be integrity-checked — that
is precisely what sealing them accomplishes — so they are reported through
`legacyCount` / `backfillPending` instead.

### 3.1 Anchored head hash (truncation detection)

A fundamental limit of any pure hash chain: if an attacker deletes the
*newest* entries, the surviving chain remains internally consistent and the
verifier cannot distinguish truncation from "the chain just ends there."

To make truncation detectable, `verifyChain({ expectedHeadHash })` accepts an
externally anchored head hash — e.g. the `headHash` recorded by a previous
verification run, exported off-database, or published somewhere the attacker
cannot rewrite. When the current head differs from the anchor, the run
reports a `chain-head` issue.

Admin workflow: record `headHash` from each verification run (a log sink,
notification channel, or even a printed runbook); pass the last anchored
value via the `X-Expected-Chain-Head` header on the next run.

### 3.2 Result shape

```jsonc
{
  "valid": true,             // no issues found
  "backfillPending": false,  // legacy rows still awaiting sealing?
  "sealedCount": 42,         // sealed rows inspected
  "legacyCount": 0,          // unsealed rows
  "skippedAnonymized": 2,    // retention-anonymized rows (§6)
  "issues": [                // first damaged entries, in chain order
    { "id": "...", "sequence": "7", "reason": "..." }
  ],
  "headSequence": "42",
  "headHash": "9f2a…"        // anchor this externally (§3.1)
}
```

The walk continues past damaged entries (up to 50 reported issues), so all
damaged regions of a chain are visible in one run.

---

## 4. Admin endpoints

Both endpoints are admin-only (`@Roles(AppRole.admin)`), versioned `/v1`,
and appear in the OpenAPI document.

### `GET /v1/audit/chain/status`

Runs a full verification and returns the result shape above. Optional
`X-Expected-Chain-Head` request header anchors the expected head hash (§3.1).

### `POST /v1/audit/chain/backfill`

Seals legacy rows onto the chain (§5). Returns `{ sealed, remaining,
headSequence, headHash }`. Safe to re-run: already-sealed rows are skipped
and an interrupted run resumes where it left off.

---

## 5. Backfilling legacy entries

Rows written before this feature exist with all chain fields `null`.
`AuditChainService.backfillChain()` seals them:

- Oldest-first (by `timestamp`, then `id`), in batches of 500, each batch in
  its own transaction guarded by the same advisory lock used for appends.
- The chain head is re-read *inside* the lock, so concurrent appends can
  safely interleave between batches: legacy rows simply extend whatever the
  current head is.
- Sequences are assigned monotonically under the lock, so a re-run never
  reassigns or duplicates a sequence.

Legacy rows are appended **after** any existing sealed entries (e.g. those
created between deployment and backfill). The chain's ordering is by
`sequence`, not by wall-clock timestamp; the verifier walks `sequence` order.

---

## 6. Interaction with the retention policy

The retention policy's **anonymize** strategy legitimately rewrites old
`AuditLog` rows (actor/entity → `[REDACTED]`, metadata → `{}`) and stamps
`deletedAt`. This is by design and would otherwise look like tampering, so:

- Verification **skips content checks** for rows with `deletedAt` set and
  counts them in `skippedAnonymized`.
- Their stored `entryHash` is still used as the link anchor, so entries after
  an anonymized row remain verifiable.

The retention policy's **hard_delete** strategy removes rows entirely; a
deleted middle entry is reported as a broken link by the verifier. Audit
retention should therefore prefer `anonymize` or `soft_delete` where the
chain matters (see `docs/database-migrations.md` and the retention policy
docs for configuration).

---

## 7. Limits (read this before trusting the chain)

The chain provides **tamper evidence**, not tamper prevention, and its
guarantees have precise boundaries:

1. **Database-level actors can still break the chain.** Anyone with enough
   database access can modify or delete rows — the chain ensures this is
   *detectable*, not impossible. An attacker who can also rewrite *every*
   subsequent entry (recomputing hashes forward from the first forged one)
   can forge a consistent chain suffix. Forward-secure schemes (signed
   checkpoints, e.g. hash chains anchored in witness cosigning or a public
   ledger) defend against that and are a possible future extension.
2. **Tail truncation is invisible without an external anchor.** Deleting the
   newest entries leaves an internally consistent chain. Anchor the head hash
   externally (§3.1) — e.g. archive each verification's `headHash` outside
   the database.
3. **Whole-chain deletion is invisible.** If every row is deleted, the
   verifier reports an empty (valid) chain. An anchor also mitigates this:
   an empty chain fails the anchored-head check.
4. **Anonymized rows leave content checks.** Any database-level actor can
   stamp `deletedAt` on a row, which exempts it from content checks while
   keeping it as a link anchor. This trade-off keeps GDPR-style erasure
   compatible with the chain; if your threat model includes operators with
   write access exporting "anonymized" history, additionally monitor the
   `skippedAnonymized` count for anomalies.
5. **No defense against an operator who controls both the database and the
   external anchor.** The anchor must live somewhere the database attacker
   cannot reach.
6. **Hash, not signature.** `entryHash` is a bare SHA-256: it proves
   consistency of the chain, not authorship. Threat models requiring
   non-repudiation need per-entry or per-checkpoint signatures from a key the
   application (not the database) controls.

---

## 8. Operations runbook

- **Deploy**: the migration adds nullable columns and one unique index — no
  backfill of existing data happens automatically, no downtime.
- **After deploy**: run `POST /v1/audit/chain/backfill` once per environment
  to seal legacy rows, then record the returned `headHash` as your first
  anchor.
- **Periodically**: run `GET /v1/audit/chain/status` (scheduled job or
  runbook task) and compare `headHash` against the previous anchor
  (`X-Expected-Chain-Head`). Alert on `valid: false` or head mismatch.
- **Verification cost**: O(n) over sealed rows, paged; on large tables run it
  off-peak.
