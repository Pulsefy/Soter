<img width="1080" height="1080" alt="Gemini_Generated_Image_efez0kefez0kefez (1)" src="https://github.com/user-attachments/assets/72250381-5090-45e4-9941-5096c190a000" />



[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Stellar](https://img.shields.io/badge/Blockchain-Stellar-blue.svg)](https://stellar.org)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2014-black.svg)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/Backend-NestJS-red.svg)](https://nestjs.com)
[![Soroban](https://img.shields.io/badge/Smart%20Contracts-Soroban-orange.svg)](https://soroban.stellar.org)

**Transparent aid, directly delivered.** Soter is an open-source, privacy-first platform on the Stellar blockchain that empowers donors and NGOs to distribute humanitarian aid directly to individuals in crisis. Create claimable packages via wallet signatures, verify needs with AI, and track immutable impact—all without middlemen or data leaks.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
  - [Deployment](#deployment)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## Overview

In a world of inefficient aid systems—where up to 50% of funds never reach those in need—Soter cuts through the noise. Built on Stellar's fast, low-cost network, it enables direct distributions via QR codes or links, AI-powered need verification, and on-chain proofs for accountability. Donors get real-time transparency; recipients claim anonymously. Join us in building a more equitable aid ecosystem.

**Target Users**: NGOs, donors, crisis coordinators, and tech contributors passionate about #Web3ForGood.

## Key Features

- **Direct Aid Claims**: Wallet-based, passwordless claiming—no accounts required.
- **AI Need Verification**: Client-side analysis of uploads for privacy-preserving eligibility.
- **Immutable Transparency**: On-chain anchoring of distributions, claims, and impact reports.
- **Global Dashboards**: Live maps and stats for monitoring aid flow (anonymized).
- **Privacy by Design**: End-to-end encryption, zero-knowledge proofs, minimal data collection.
- **Extensible**: API for NGO integrations, recurring campaigns, and carbon offsets.

## Tech Stack

| Category       | Tools                                                                 |
|----------------|-----------------------------------------------------------------------|
| **Frontend**   | Next.js 14, Tailwind CSS, Radix UI, React Query, Leaflet (maps)       |
| **Backend**    | NestJS, Prisma (PostgreSQL), BullMQ (queues), Stellar SDK             |
| **Blockchain** | Stellar Network, Soroban (Rust contracts), Freighter API (wallets)    |
| **AI/ML**      | OpenAI/Grok API (verification & insights), TensorFlow.js (client-side)|
| **DevOps**     | Turborepo (monorepo), GitHub Actions (CI/CD), Vercel/Supabase (hosting)|
| **Other**      | TypeScript, crypto-js (encryption), Jest/Playwright (testing)         |

## Project Structure

Soter uses a monorepo under the `app` parent folder for streamlined development:

```
.
├── app/                  # Monorepo root
│   ├── frontend/         # Next.js app (UI, maps, wallet connect)
│   ├── backend/          # NestJS API (aid logic, verification, APIs)
│   ├── mobile/           # Expo React Native app (field operations)
│   ├── contracts/        # Rust sources (Soroban AidEscrow contract)
│   └── soroban/          # Soroban CLI scripts (build/deploy/invoke)
├── docs/                 # Additional guides (e.g., API docs)
├── .github/              # Workflows, issue templates
├── README.md             # This file
└── LICENSE               # MIT License
```

## Getting Started

### Prerequisites

- Node.js ≥ 18
- Rust (for Soroban contracts)
- Stellar wallet (e.g., Freighter for testing)
- PostgreSQL (local or Supabase)
- Testnet XLM (from [Stellar Laboratory](https://laboratory.stellar.org))

### Setup

1. **Clone & Install**  
   ```bash
   git clone <your-repo-url>
   cd Soter
   pnpm install
   ```

2. **Environment Variables**  
   Create `.env` files in each package (see `.env.example`):
   - `app/backend/.env`: `DATABASE_URL`, `STELLAR_RPC_URL=https://soroban-testnet.stellar.org`, `OPENAI_API_KEY`
   - `soroban/.env`: `SECRET_KEY=your-stellar-secret-key`
   - `app/mobile/.env`: `EXPO_PUBLIC_API_URL` (points to backend)

3. **Database Setup**  
   ```bash
   pnpm --filter backend prisma:generate
   pnpm --filter backend prisma:migrate
   ```

4. **Build Contracts**  
   ```bash
   cd soroban
   cargo install --git https://github.com/stellar/rs-soroban-env soroban-cli
   soroban contract build
   ```

### Deployment

1. **Deploy Contracts**  
   ```bash
   cd app/soroban
   soroban contract deploy \
     --wasm target/soroban/wasm32-unknown-unknown/release/aid_escrow.wasm \
     --source YOUR_SECRET_KEY \
     --network testnet
   ```
   Note the contract ID and update `app/backend/.env`.

2. **Run Locally**  
   ```bash
   # From monorepo root (app/)
   cd app

   # Frontend (Next.js on port 3000)
   pnpm --filter frontend dev
   # Or: cd frontend && pnpm dev

   # Backend (NestJS on port 4000)
   pnpm --filter backend start:dev
   # Or: cd backend && pnpm start:dev

   # Contracts (in another terminal)
   cd soroban && soroban contract invoke ...  # For testing

   # Health checks
   # Frontend: http://localhost:3000/api/health
   # Backend: http://localhost:4000/health
   # Mobile (requires backend running)
   pnpm --filter mobile start
   ```

3. **Production**  
   - Frontend: Deploy to Vercel (`vercel --prod`).
   - Backend: DigitalOcean/Heroku.
   - Contracts: Mainnet via Soroban CLI.

## Development

- **Scripts** (run from root with `pnpm`):
  - `pnpm build`: Full monorepo build.
  - `pnpm test`: Run tests across packages.
  - `pnpm lint`: ESLint checks.
  - `pnpm --filter <package> <command>`: Run command for a specific package.

- **Local Testing**: Use Stellar Testnet; simulate claims with demo wallets.
- **API Docs**: Auto-generated at `/api/docs` in dev mode.

## Contributing

We welcome all contributions! Focus areas: AI enhancements, mobile optimizations, new integrations.

1. Fork the repo.
2. Create a branch: `git checkout -b feature/your-feature`.
3. Commit: `git commit -m "feat: add your feature"`.
4. Push: `git push origin feature/your-feature`.
5. Open a PR with a clear description.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Report issues via GitHub.

## License

MIT License—see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Stellar](https://stellar.org) – Fast, inclusive blockchain for global good.
- [Next.js](https://nextjs.org) – React framework.
- [NestJS](https://nestjs.com) – Enterprise-grade backend.
- [Soroban](https://soroban.stellar.org) – Smart contracts on Stellar.
- Inspired by GiveDirectly & MSF for transparent aid.

  
## Support & Community
- Join the [Soter Discord](https://discord.gg/gBmApTNVV) for real-time help, discussions, and updates.
- Have questions? Open an issue or DM @pulsefy.

---

*Built with ❤️ for humanity. Star us, contribute, and help save lives.* 🌍
