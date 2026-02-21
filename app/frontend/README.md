# Soter Frontend

The frontend for Soter, built with Next.js 15+, providing a modern, responsive interface for transparent humanitarian aid distribution on the Stellar blockchain.

## Overview

This Next.js application serves as the user-facing interface for the Soter platform, enabling:

- **Donor Dashboard**: Create and manage aid campaigns
- **Recipient Portal**: Claim aid packages via wallet connection
- **Live Maps**: Visualize aid distribution using Leaflet
- **AI Verification**: Client-side need verification workflows
- **Blockchain Integration**: Connect with Stellar wallets (Freighter) and interact with Soroban smart contracts

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS 4
- **UI Components**: Radix UI
- **Data Fetching**: React Query (TanStack Query)
- **Mapping**: Leaflet + React Leaflet
- **Blockchain**: Stellar SDK, Freighter Wallet API
- **Linting**: ESLint 9

## Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── api/               # API routes (health check, etc.)
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Homepage
│   └── globals.css        # Global styles
├── components/            # React components (to be added)
│   ├── ui/               # Radix UI components
│   └── features/         # Feature-specific components
├── lib/                   # Utilities and providers
│   └── query-provider.tsx # React Query setup
├── hooks/                 # Custom React hooks
├── types/                 # TypeScript type definitions
└── config/                # Configuration files
```

## Getting Started

### Prerequisites

- Node.js ≥ 18
- pnpm (recommended) or npm/yarn
- A Stellar wallet (e.g., Freighter extension)

### Installation

From the monorepo root (`app/`):

```bash
pnpm install
```

Or from this directory:

```bash
cd app/frontend
pnpm install
```

### Environment Setup

1. Copy the example environment file:

```bash
cp .env.example .env.local
```

2. Configure the variables in `.env.local`:

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:4000

# Stellar Network (testnet, futurenet, or mainnet)
NEXT_PUBLIC_STELLAR_NETWORK=testnet
# Optional alias: NEXT_PUBLIC_NETWORK is used if NEXT_PUBLIC_STELLAR_NETWORK is not set
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Optional: application environment label (dev, staging, prod) — shown in the navbar
# NEXT_PUBLIC_ENV_NAME=dev

# Contract IDs (get these after deploying contracts)
NEXT_PUBLIC_AID_ESCROW_CONTRACT_ID=your_contract_id
NEXT_PUBLIC_VERIFICATION_CONTRACT_ID=your_contract_id
```

The navbar displays a small **network & environment indicator** (e.g. “Network: testnet”, “Environment: dev”) so contributors and testers always know which Stellar network and app environment they are using. These values come from `NEXT_PUBLIC_STELLAR_NETWORK` (or `NEXT_PUBLIC_NETWORK`) and optional `NEXT_PUBLIC_ENV_NAME`; they are safe to expose in production and contain no secrets.

### Development

Run the development server:

```bash
# From monorepo root
pnpm --filter frontend dev

# Or from this directory
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The app uses hot module replacement (HMR) - changes are reflected immediately.

### Build

Build for production:

```bash
pnpm build
```

Test the production build locally:

```bash
pnpm start
```

## Available Scripts

| Script       | Description                                    |
| ------------ | ---------------------------------------------- |
| `dev`        | Start development server on port 3000          |
| `build`      | Create optimized production build              |
| `start`      | Run production server                          |
| `lint`       | Run ESLint for code quality checks             |
| `type-check` | Run TypeScript compiler without emitting files |
| `test`       | Run test suite (placeholder for now)           |

## Health Check

The frontend includes a health check endpoint for monitoring:

**Endpoint**: `GET /api/health`

**Response**:

```json
{
  "status": "ok",
  "timestamp": "2026-01-19T00:00:00.000Z",
  "service": "soter-frontend"
}
```

Use this endpoint in CI/CD pipelines, monitoring tools, or health check probes.

## Mock API

To enable the mock API layer for development when the backend is unavailable:

1.  Set `NEXT_PUBLIC_USE_MOCKS=true` in your `.env.local` file.
2.  The application will intercept requests to supported endpoints (e.g., `/health`, `/aid-packages`) and return mock data.
3.  Mock handlers are defined in `src/lib/mock-api/handlers.ts`.

## Key Features Implementation

### React Query Setup

Data fetching is handled by React Query with configured defaults:

- Stale time: 60 seconds
- Refetch on window focus: disabled

Provider is located at `src/lib/query-provider.tsx` and wrapped in the root layout.

### Radix UI Components

Pre-installed Radix primitives:

- `@radix-ui/react-dialog` - Modal dialogs
- `@radix-ui/react-dropdown-menu` - Dropdown menus
- `@radix-ui/react-toast` - Toast notifications
- `@radix-ui/react-avatar` - User avatars
- `@radix-ui/react-select` - Select inputs
- `@radix-ui/react-slot` - Composition utility

Create custom components in `src/components/ui/`.

### Leaflet Maps

For mapping aid distributions:

```tsx
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Use in components
<MapContainer center={[51.505, -0.09]} zoom={13}>
  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
  <Marker position={[51.505, -0.09]}>
    <Popup>Aid Distribution Point</Popup>
  </Marker>
</MapContainer>;
```

**Note**: Leaflet requires client-side rendering. Use `dynamic` imports with `ssr: false` for map components.

### Stellar Wallet Integration

Connect with Freighter wallet (to be implemented):

```tsx
import { isConnected, getPublicKey } from '@stellar/freighter-api';

// Check if wallet is available
const hasWallet = await isConnected();

// Get user's public key
const publicKey = await getPublicKey();
```

## Development Guidelines

### Code Style

- Use TypeScript for all new files
- Follow ESLint rules (run `pnpm lint`)
- Use functional components with hooks
- Prefer named exports for components
- Use Tailwind utility classes for styling

### Component Organization

```tsx
// Component template
interface MyComponentProps {
  title: string;
  onAction?: () => void;
}

export function MyComponent({ title, onAction }: MyComponentProps) {
  return <div>{title}</div>;
}
```

### State Management

- **Server state**: React Query
- **Client state**: React hooks (useState, useReducer)
- **Global state**: Context API (if needed)

### API Calls

Use React Query hooks for data fetching:

```tsx
import { useQuery } from '@tanstack/react-query';

function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/campaigns`);
      return res.json();
    },
  });
}
```

## Troubleshooting

### Port Already in Use

If port 3000 is occupied:

```bash
# Windows PowerShell
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or use a different port
pnpm dev -- -p 3001
```

### Hydration Errors

Common with server/client mismatches. For client-only components:

```tsx
import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('./MapComponent'), { ssr: false });
```

### Environment Variables Not Loading

- Ensure variables start with `NEXT_PUBLIC_` for client-side access
- Restart dev server after changing `.env.local`
- Check that `.env.local` is in the frontend root (not `src/`)

### Type Errors with Leaflet

If you encounter Leaflet type issues:

```bash
pnpm add -D @types/leaflet
```

### Build Failures

```bash
# Clear Next.js cache
rm -rf .next

# Reinstall dependencies
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Type check
pnpm type-check
```

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Set the root directory to `app/frontend`
3. Add environment variables in the Vercel dashboard
4. Deploy

```bash
# Or via CLI
cd app/frontend
vercel --prod
```

### Docker

(To be added based on project needs)

## Testing

Tests will be added as the project matures. Planned testing stack:

- **Unit**: Jest + React Testing Library
- **E2E**: Playwright
- **Integration**: Testing against local backend

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflow, commit conventions, and PR guidelines.

## Related Documentation

- [Root README](../../README.md) - Project overview
- [Backend README](../backend/README.md) - API documentation
- [Contracts README](../contracts/README.md) - Smart contract details
- [Next.js Docs](https://nextjs.org/docs)
- [Stellar Docs](https://developers.stellar.org)

## License

MIT - See [LICENSE](../../LICENSE) for details.

---

**Built with ❤️ for transparent humanitarian aid** 🌍
