<p align="center">
  <img src="assets/soter-logo.png" width="160" alt="Soter logo" />
</p>

# Soter

Soter is a humanitarian aid distribution platform built on the Stellar ecosystem (Soroban). It combines on-chain escrow and auditable events with off-chain verification and field-ready client apps.

## Features

### Core
- On-chain escrow for aid packages (create, claim, disburse, revoke, refund)
- Indexer-friendly contract events for transparency and analytics
- Backend APIs for orchestration, role-based access, and operational tooling
- Frontend dashboard for campaigns, review workflows, and reporting
- Mobile app for field operations (scan, view details, submit/confirm claim flows)

### Testnet readiness
- Network guardrails to prevent cross-network mismatches
- Deterministic test modes (where applicable) for stable demos and CI
- Health probes and observability hooks for on-chain calls and background jobs

## What’s in this repo

- Backend (NestJS): APIs, orchestration, persistence, on-chain adapter, observability ([backend README](app/backend/README.md))
- Smart Contracts (Soroban/Rust): AidEscrow escrow + claim flows ([onchain README](app/onchain/README.md))
- Frontend (Next.js): admin/donor UI, dashboards, wallet flows ([frontend README](app/frontend/README.md))
- Mobile (Expo): field operations + pilot flows ([mobile README](app/mobile/README.md))
- AI Service (FastAPI): OCR/anonymization/fraud checks for verification flows ([ai-service README](app/ai-service/README.md))

## Tech stack

- Smart contracts: Rust + Soroban
- Backend: NestJS (TypeScript), Prisma
- Frontend: Next.js (App Router), React, Tailwind CSS
- Mobile: Expo (React Native), WalletConnect
- AI service: FastAPI (Python), Pydantic
- CI: GitHub Actions

## Repository structure

```text
Soter/
├── .github/workflows/        # CI workflows
├── app/
│   ├── onchain/              # Soroban contracts (Rust)
│   ├── backend/              # NestJS API server + on-chain adapter
│   ├── frontend/             # Next.js web app
│   ├── mobile/               # Expo mobile app
│   └── ai-service/           # FastAPI service (OCR/anonymize/fraud, etc.)
└── assets/                   # Repository assets (logo)
```

## Setup instructions

### Prerequisites
- Node.js 18+
- Python 3.11+
- Rust toolchain + Soroban CLI (for contracts)

### Local development (by service)

#### Backend (NestJS)

```bash
cd app/backend
npm ci
cp .env.example .env
npm run prisma:migrate
npm run start:dev
```

#### Frontend (Next.js)

```bash
cd app/frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

#### AI service (FastAPI)

```bash
cd app/ai-service
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

#### Mobile (Expo)

```bash
cd app/mobile
pnpm install
cp .env.example .env
pnpm start
```

## Testnet setup (high level)

- Deploy the Soroban contracts to testnet and capture contract IDs.
- Configure the backend to target testnet RPC + network passphrase + contract ID(s).
- Configure frontend/mobile environment variables to point at the backend and set the testnet network + contract IDs.

Helpful starting points:
- Backend Soroban integration notes: [SOROBAN_INTEGRATION.md](app/backend/src/onchain/SOROBAN_INTEGRATION.md)
- Contract docs and method/event reference: [onchain README](app/onchain/README.md)

## Testing

- Backend: `cd app/backend && npm test` and `npm run test:e2e`
- Frontend: `cd app/frontend && pnpm lint && pnpm type-check && pnpm test`
- Mobile: `cd app/mobile && pnpm test && pnpm lint`
- AI service: `cd app/ai-service && pytest`

## Contributing

We review contributor branches frequently. Keep PRs small and focused, and include:
- A clear problem statement + acceptance criteria
- Tests or a short manual test plan
- No secrets committed (keys, tokens, seed phrases)

For component-specific contribution details, follow the README in each folder linked above.
