# Contract Deployment Registry

Append-only log of every `aid_escrow` (or future contract) deployment that any
consumer (backend, mobile, or a shared environment) has pointed at. See
[`DEPLOYMENT.md`](DEPLOYMENT.md) §5 for when/how to add a row.

Rules:
- **Never edit or delete a historical row.** If a deployment is replaced, add
  a new row and change the old row's Status to `superseded` with a note
  pointing at the row that replaces it.
- Add a row as soon as a deployment passes the validation checklist in
  `DEPLOYMENT.md` §3, before pointing any consumer at it.
- Update a row's Notes with the date each consumer (backend / mobile) actually
  cut over — the registry should be able to answer "what was live in
  production for the mobile app on date X," not just "when did we run
  `soroban contract deploy`."

| Date (UTC) | Network | Contract ID | Wasm SHA-256 | Source commit | Contract version | Deployed by | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _(none yet)_ | | | | | | | | Seed row — replace with the first real deployment. Remove this row once a real entry exists. |
