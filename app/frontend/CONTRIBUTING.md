# Contributing to Soter Frontend

Thank you for your interest in contributing to the Soter frontend! This document covers the development workflow, code standards, and conventions for submitting changes.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Branching Strategy](#branching-strategy)
- [Commit Conventions](#commit-conventions)
- [Code Standards](#code-standards)
- [Validation Checklist](#validation-checklist)
- [Pull Request Process](#pull-request-process)
- [UI/UX Guidelines](#uiux-guidelines)
- [Common Tasks](#common-tasks)
- [Getting Help](#getting-help)

---

## Getting Started

### Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Node.js | 18.x | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| pnpm | 9.x | `npm install -g pnpm` or [standalone installer](https://pnpm.io/installation) |
| Freighter | latest | [Browser extension](https://www.freighter.app/) for wallet testing |

> **Why pnpm?** This repo uses pnpm workspaces. Using `npm` or `yarn` inside `app/frontend/` directly will produce a mismatched lockfile and can break other workspace packages. Always use `pnpm`.

### Initial Setup

1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/soter.git
   cd soter
   ```

2. **Install dependencies** from the monorepo root:
   ```bash
   pnpm install
   ```
   This installs dependencies for all workspace packages at once using the shared `pnpm-lock.yaml`. Never manually edit the lockfile.

3. **Set up environment variables**:
   ```bash
   cd app/frontend
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

   Key variables to configure (testnet values are fine for local dev):
   ```bash
   NEXT_PUBLIC_API_URL=http://localhost:4000
   NEXT_PUBLIC_STELLAR_NETWORK=testnet   # or NEXT_PUBLIC_NETWORK — shown in navbar
   NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
   NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
   NEXT_PUBLIC_AID_ESCROW_CONTRACT_ID=your_contract_id
   NEXT_PUBLIC_VERIFICATION_CONTRACT_ID=your_contract_id
   # NEXT_PUBLIC_ENV_NAME=dev   # optional; app environment label shown in navbar (dev/staging/prod)
   ```

   The navbar shows a **network & environment indicator** (Network: testnet, Environment: …) so you always know which Stellar network and environment you’re targeting. These values are safe to show in production (no secrets).

   > All client-side variables must be prefixed with `NEXT_PUBLIC_`. Restart the dev server after any change to `.env.local`.

4. **Start the dev server**:
   ```bash
   pnpm dev
   # or from the monorepo root:
   pnpm --filter frontend dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

---

## Development Workflow

### 1. Create a feature branch

Always work on a branch, never directly on `main` or `develop`:

```bash
git checkout -b feature/your-feature-name
```

### 2. Make your changes

- Follow the [Code Standards](#code-standards) below
- Add or update tests as needed
- Update documentation if you change APIs or add features
- Run the [Validation Checklist](#validation-checklist) locally before pushing

### 3. Commit your changes

Follow the [Commit Conventions](#commit-conventions):

```bash
git add .
git commit -m "feat(ui): add campaign creation dialog"
```

### 4. Push and open a PR

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub. See [Pull Request Process](#pull-request-process) for the template and review steps.

---

## Branching Strategy

We use **Git Flow**:

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `develop` | Integration branch for features |
| `feature/*` | New features |
| `bugfix/*` | Bug fixes |
| `hotfix/*` | Urgent production fixes |
| `release/*` | Release preparation |

Branch names should be descriptive and kebab-case:

```bash
# Good
feature/wallet-integration
bugfix/map-marker-positioning
hotfix/auth-token-expiry

# Bad
new-feature
fix
myBranch
```

---

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Use for |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructuring, no feature change |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Maintenance (deps, config) |
| `ci` | CI/CD changes |

### Scopes

Use the affected feature or area: `ui`, `api`, `wallet`, `maps`, `campaign`, `claim`, `auth`.

### Examples

```bash
# Good
git commit -m "feat(wallet): add Freighter wallet connection"
git commit -m "fix(maps): resolve marker icon not displaying in production"
git commit -m "docs(contributing): add environment variable instructions"
git commit -m "refactor(api): extract fetch logic to useCampaigns hook"

# Bad
git commit -m "update stuff"
git commit -m "fixes"
git commit -m "WIP"
```

For complex changes, use a multi-line body:

```bash
git commit -m "feat(campaign): add multi-currency support

- Add currency selector dropdown
- Update contract interaction to pass currency type
- Add conversion rate display

Closes #123"
```

---

## Code Standards

### TypeScript

- **Always use TypeScript.** No `.js` or `.jsx` files in `src/`.
- **Define explicit interfaces** for component props and data structures. Don't use inline object types for non-trivial shapes.
- **Avoid `any`.** Use `unknown` or a proper type. If `any` is truly unavoidable, add an inline comment explaining why.
- **Use type inference** where it doesn't sacrifice clarity.

```tsx
// Good
interface CampaignCardProps {
  title: string;
  amount: number;
  onClaim: () => void;
}

export function CampaignCard({ title, amount, onClaim }: CampaignCardProps) {
  return <div onClick={onClaim}>{title}: {amount} XLM</div>;
}

// Bad
export function CampaignCard(props: any) {
  return <div>{props.title}</div>;
}
```

### React Components

- **Use functional components** with hooks. No class components.
- **Use named exports.** Default exports make refactoring harder and can break fast refresh in some editors.
- **Destructure props** in function parameters.
- **Use fragment shorthand** (`<>` not `<React.Fragment>`).

```tsx
// Good
export function UserAvatar({ name, imageUrl }: UserAvatarProps) {
  return (
    <>
      <img src={imageUrl} alt={name} />
      <span>{name}</span>
    </>
  );
}

// Bad
export default (props) => (
  <div>
    <img src={props.imageUrl} />
  </div>
);
```

### Styling

- **Use Tailwind CSS 4 utilities.** Avoid custom CSS unless Tailwind cannot achieve the result.
- **Never use inline `style` props** for layout or spacing — use Tailwind classes.
- **Always support dark mode** with the `dark:` prefix.
- Use responsive modifiers (`sm:`, `md:`, `lg:`) for adaptive layouts.
- For conditional class logic, use `clsx` or a `cn` helper rather than template strings.

```tsx
// Good
<button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:bg-blue-500">
  Submit
</button>

// Bad — inline styles
<button style={{ padding: "8px 16px", backgroundColor: "blue" }}>
  Submit
</button>
```

### File and Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Component name | PascalCase | `CampaignCard` |
| File name | kebab-case | `campaign-card.tsx` |
| Hook name | camelCase with `use` prefix | `useCampaigns` |
| Types / Interfaces | PascalCase | `CampaignData` |
| Constants | SCREAMING_SNAKE_CASE | `API_BASE_URL` |

### File Organization

```
src/components/
├── ui/                   # Reusable Radix UI primitives
│   ├── button.tsx
│   ├── dialog.tsx
│   └── input.tsx
├── features/             # Feature-specific components
│   ├── campaign/
│   │   ├── campaign-card.tsx
│   │   └── campaign-form.tsx
│   └── wallet/
│       └── wallet-connect.tsx
└── layout/               # Layout components
    ├── header.tsx
    └── footer.tsx
```

### Import Order

1. React and Next.js
2. External libraries
3. Internal components and utilities
4. Types
5. Styles

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { Campaign } from "@/types/campaign";
```

### Leaflet / Map Components

Leaflet requires a real DOM and cannot render server-side. **Any component that imports from `leaflet` or `react-leaflet` must use a dynamic import with `ssr: false`**, or the build will fail.

```tsx
// Good
const AidMap = dynamic(() => import("@/components/features/maps/aid-map"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

// Bad — will cause a build error
import AidMap from "@/components/features/maps/aid-map";
```

### Stellar / Freighter Integration

- Freighter API calls (`isConnected`, `getPublicKey`, etc.) are **browser-only**. Guard them with `typeof window !== "undefined"` or call them inside `useEffect`, never during render.
- **Never log or store a user's private key or seed phrase**, even temporarily.
- Always target **testnet** during development (`NEXT_PUBLIC_STELLAR_NETWORK=testnet`).

### State Management

| State type | Tool |
|-----------|------|
| Server / async state | React Query (`useQuery`, `useMutation`) |
| Local component state | `useState`, `useReducer` |
| Shared client state | React Context (if needed) |

Configure React Query `queryKey` arrays to be specific enough to avoid cache collisions: use `["campaigns", campaignId]` not just `["campaigns"]`.

### Environment Variables

- All client-side variables must be prefixed with `NEXT_PUBLIC_`.
- Document every new variable in `.env.example` with a comment explaining its purpose.
- Never commit real secrets. `.env.local` is gitignored.

---

## Validation Checklist

Run these checks locally before pushing. CI runs exactly the same steps and will block merge if any fail.

### 1 — Type check

```bash
pnpm type-check
```

Runs `tsc --noEmit`. Catches type errors including incorrect prop types, missing return types, and SDK type mismatches (common with Stellar and Freighter APIs). Fix all type errors before moving on — the build will fail on them anyway.

### 2 — Lint

```bash
pnpm lint
```

Runs ESLint 9. **Zero-warning policy** — ESLint is configured with `--max-warnings 0`, so any warning is treated as an error and will fail CI.

Auto-fix what you can first:

```bash
pnpm lint --fix
```

### 3 — Tests

```bash
pnpm test
```

> **Note:** The test suite is actively being built out. The planned stack is **Jest + React Testing Library** for unit/integration tests and **Playwright** for E2E. The `pnpm test` script is currently a placeholder — this section will expand as tests land.

#### Testing conventions (follow these as tests are added)

- Co-locate test files with the source they cover: `campaign-card.tsx` → `campaign-card.test.tsx`.
- Query by role, label, or visible text — in that order. Avoid `getByTestId` unless there is no accessible alternative.
- Wrap renders in a fresh `QueryClientProvider` per test to prevent React Query state bleed between tests.
- Mock Stellar/Freighter API calls at the module boundary. Never make real network or blockchain calls in unit tests.

### 4 — Production build

```bash
pnpm build
```

Compiles the Next.js app in production mode and catches anything that slipped through the earlier steps: unresolvable imports, undefined `NEXT_PUBLIC_*` variables, and SSR issues from browser-only APIs like Leaflet and Freighter.

Always run this locally before opening a PR if you have:

- Added or changed environment variables
- Added a new dependency or changed import paths
- Modified `next.config.ts` or Tailwind config
- Added a new page, route, or Leaflet component

Verify the production output:

```bash
pnpm start   # serves the build on http://localhost:3000
```

### Pre-push checklist

- [ ] `pnpm type-check` — no errors
- [ ] `pnpm lint` — no warnings or errors
- [ ] `pnpm test` — all tests pass
- [ ] `pnpm build` — build succeeds
- [ ] Manually tested in the dev environment
- [ ] Tested in both light and dark modes
- [ ] Tested responsive layout on mobile / tablet / desktop

---

## Pull Request Process

### Before opening a PR

- [ ] Branch is up-to-date with `develop`
- [ ] All validation checks pass locally
- [ ] New features include tests where applicable
- [ ] Documentation updated (README, inline comments, `.env.example`)
- [ ] Screenshots attached for any UI changes

### PR description template

```markdown
## Description

Brief summary of the change and why it's needed.

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Tested locally
- [ ] Added unit tests
- [ ] Tested on Stellar Testnet (for wallet/contract changes)

## Screenshots (if applicable)

## Related Issues

Closes #
```

### Review process

1. **Automated CI** runs `type-check`, `lint`, `test`, and `build` on every push.
2. **Code review** — at least one maintainer reviews your PR.
3. **Address feedback** — push changes to the same branch; no need to open a new PR.
4. **Merge** — maintainer merges once approved.
   - Feature branches → squash and merge
   - Hotfixes → rebase and merge

---

## UI/UX Guidelines

### Core principles

- **Accessibility first** — use semantic HTML, ARIA labels, and keyboard navigation.
- **Mobile-first** — design for mobile, enhance for desktop.
- **Dark mode always** — every new component must support `dark:` variants.
- **Performance** — lazy-load images, use `next/image`, and use `dynamic` imports for heavy components (especially maps).

### Component states

Every interactive component should handle all four states:

| State | What to show |
|-------|-------------|
| Loading | Skeleton or spinner |
| Error | Clear message with a retry option |
| Empty | Helpful guidance, not a blank space |
| Destructive action | Confirmation dialog before proceeding |

### Accessibility

- Use semantic HTML (`<button>`, `<nav>`, `<main>`, `<section>`).
- Add descriptive `alt` text to all images.
- Ensure color contrast meets WCAG AA.
- Test keyboard navigation (Tab, Enter, Escape, arrow keys).
- Prefer Radix UI primitives — they ship with accessibility built in.

```tsx
// Good — accessible button
<button type="button" aria-label="Close dialog" onClick={onClose}>
  <XIcon aria-hidden="true" />
</button>

// Bad — inaccessible div acting as a button
<div onClick={onClose}>X</div>
```

---

## Common Tasks

### Adding a new page

Create a file in `src/app/your-route/page.tsx`. Note that Next.js App Router requires a **default export** for page files (unlike regular components, which use named exports):

```tsx
// src/app/campaigns/page.tsx
export default function CampaignsPage() {
  return <main>Campaigns</main>;
}
```

Add a navigation link if users need to reach it from the UI.

### Adding a new component

1. Create the file in `src/components/ui/` (primitive) or `src/components/features/<feature>/` (feature-specific).
2. Define a props interface.
3. Implement with a named export.

### Adding a new API route

```tsx
// src/app/api/your-route/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ data: "value" });
}
```

### Installing a new library

```bash
pnpm add library-name            # runtime dependency
pnpm add -D @types/library-name  # types if needed
```

If the library is browser-only (like Leaflet or Freighter), document the `dynamic` import pattern needed to avoid SSR errors.

### Adding or updating environment variables

1. Add to `.env.example` with a placeholder value and a comment.
2. Document in `README.md` under "Environment Setup".
3. Update the Vercel dashboard for staging/production.

---

## Troubleshooting

**Hydration errors in the browser** — usually caused by Leaflet or Freighter running during SSR. Wrap the component with `dynamic(() => import(...), { ssr: false })`. See [Leaflet / Map Components](#leaflet--map-components).

**Freighter calls return `undefined`** — Freighter is browser-only and requires the extension to be installed. Guard all calls with `typeof window !== "undefined"` and run them inside `useEffect`.

**Environment variables are `undefined` at runtime** — confirm the variable starts with `NEXT_PUBLIC_`, exists in `.env.local` (not just `.env.example`), and that you've restarted the dev server.

**Build fails after adding a Leaflet component** — you likely imported it without `ssr: false`. See [Leaflet / Map Components](#leaflet--map-components).

**Port 3000 already in use**:
```bash
# macOS / Linux
lsof -ti:3000 | xargs kill

# Windows PowerShell
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or just run on a different port
pnpm dev -- -p 3001
```

**Stale build or dependency issues**:
```bash
rm -rf .next          # clear Next.js build cache
rm -rf node_modules   # full clean reinstall
pnpm install
```

---

## Getting Help

- **Questions**: Open a [GitHub Discussion](https://github.com/your-org/soter/discussions)
- **Bugs**: Open a [GitHub Issue](https://github.com/your-org/soter/issues) with steps to reproduce
- **Docs**: Check the [README](./README.md) and [project docs](../../README.md) first

## Code of Conduct

Be respectful, inclusive, and constructive. We're building this for humanitarian impact — every contribution matters. 💙