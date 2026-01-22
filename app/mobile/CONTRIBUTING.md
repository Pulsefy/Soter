# Contributing to Soter Mobile

Thank you for contributing to the mobile module!

## Branching & Workflow

- Create feature branches from `main` or the current feature branch.
- Use descriptive names: `feature/mobile-auth` or `fix/navigation-header`.

## Commit Style

We follow conventional commits:
- `feat(mobile): ...`
- `fix(mobile): ...`
- `docs(mobile): ...`

## Tests & Linting

Before opening a PR, ensure:
1. All tests pass: `pnpm test`
2. Linting passes: `pnpm lint`

## PR Checklist

- [ ] Branch is up to date with `main`.
- [ ] New features include tests.
- [ ] No hardcoded API endpoints (use `.env`).
- [ ] Documentation updated if necessary.
- [ ] Screenshots/videos included for UI changes.
