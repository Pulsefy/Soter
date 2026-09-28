# Architecture Decision Records

This is a lightweight, **append-only** log of significant architecture decisions
in Soter. It exists so a new contributor or maintainer can understand *why* the
codebase is shaped the way it is, without reconstructing the reasoning from
scattered PR descriptions and code comments.

## Format

Each decision is one Markdown file named `NNNN-short-title.md` (zero-padded,
increasing). Keep entries short — adding one should be a five-minute task, not a
research project. Each entry has:

- **Status** — Accepted / Superseded / Deprecated (+ successor if any)
- **Date / context** — when and in what wave/context it was decided
- **Decision** — what was decided, in one or two sentences
- **Alternatives considered** — the main options that were rejected, and why
- **Consequences** — what this makes easy or hard (optional but encouraged)

To add a decision: copy the shape of an existing entry, take the next number,
and append it. Do not rewrite past entries; if a decision changes, add a new
entry that supersedes the old one and update the old entry's **Status**.

## Log

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-storage-driver-abstraction.md) | Evidence storage driver abstraction | Accepted |
| [0002](0002-onchain-adapter-pattern.md) | On-chain adapter pattern | Accepted |
| [0003](0003-mock-data-and-demo-mode.md) | Mock data / demo mode | Accepted |
