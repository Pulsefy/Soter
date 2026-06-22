# Contributing (Backend)

## Scope

This document applies to `app/backend` only.

## Workflow

- Create a branch from `main`:
  - `feature/<short-name>` for new work
  - `fix/<short-name>` for bug fixes
  - `chore/<short-name>` for tooling/docs

## Commits

- Use conventional commits:
  - `feat(backend): ...`
  - `fix(backend): ...`
  - `chore(backend): ...`

## Local checks (required)

Run from repo root:

```bash
pnpm install
pnpm --filter backend lint
pnpm --filter backend test
```

If your change touches the database schema:

```bash
pnpm --filter backend prisma:generate
pnpm --filter backend prisma:migrate
```

## Pull Request expectations

Include all of the following in the PR description:

- **What changed**
- **How to run locally**
- **Test logs**
  - `pnpm --filter backend test`
  - `pnpm --filter backend lint`
- **Curl output** for `/health`
  - `curl -s http://localhost:3001/health | jq`
- **File tree excerpt** proving docs exist
- **Closes** `#<issue_id>`

## PR checklist

- [ ] No secrets committed (only `.env.example`)
- [ ] `pnpm --filter backend test` passes
- [ ] `pnpm --filter backend lint` passes
- [ ] Database migration included if schema changed
- [ ] `/health` returns `200` locally
