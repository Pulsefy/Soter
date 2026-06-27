# Merkle Allowlist Tool (Soroban / aid_escrow)

Generates Merkle roots and proofs compatible with `aid_escrow::claim_with_proof`.

## Hashing scheme (matches on-chain contract)

- **Leaf:** `sha256(stellar_address_string)` — the UTF-8 string form of the G-address
- **Parent:** `sha256(sorted_concat(left, right))` — siblings ordered by byte value before hashing
- **Root / proof elements:** 64-character lowercase hex strings (32 bytes)

## Usage

```bash
cd tools/merkle-allowlist
node index.js
```

Edit `sample_allowlist.json` with Stellar G-addresses (no amounts — eligibility is address-only).

## Run self-checks

```bash
node test.js
```

## Output

The CLI prints JSON lines for:

- `valid` — member proof verifies against the computed root
- `invalid_proof_path` — tampered sibling rejected
- `wrong_recipient` — proof for one address fails for another
- `mismatched_root` — correct proof fails against a different root

Use the `ROOT` value as package metadata key `merkle_root` when creating restricted packages.

## Programmatic API

```javascript
const { buildMerkleTree, proofForAddress, bytesToHex } = require('./merkle');

const tree = buildMerkleTree(['G...', 'G...']);
const rootHex = bytesToHex(tree.root);
const proof = proofForAddress(tree, 'G...');
```
