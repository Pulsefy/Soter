# Monorepo Local Development Runbook

This guide provides a practical, step-by-step walkthrough to get a full local Soter stack running from a clean git clone.

---

## 1. System Requirements & Dependencies

Before starting, ensure the following tools are installed:

| Component | Minimum Version | Installation / Notes |
|-----------|----------------|----------------------|
| **Node.js** | v20+ | `node -v` (LTS recommended) |
| **pnpm / npm** | pnpm 9+ / npm 10+ | `npm install -g pnpm` |
| **Python** | 3.10+ | Required for `app/ai-service` and PII scrubber scripts |
| **PostgreSQL** | 15+ | Local service or Docker container (`port 5432`) |
| **Redis** | 7+ | Local service or Docker container (`port 6379`) |
| **Rust & Soroban CLI** | Rust 1.78+, Soroban CLI 21+ | Required for smart contract builds in `app/onchain` |

---

## 2. Quickstart Startup Sequence

Follow this startup order to avoid connection dependency errors:

```
[1. Infra: PostgreSQL + Redis] -> [2. Backend Setup & Prisma] -> [3. Backend Server] -> [4. AI Service] -> [5. Frontend / Mobile]
```

### Step 1: Start Infrastructure Services (PostgreSQL & Redis)

Using Docker Compose (recommended):

```bash
# Unix (Linux / macOS)
docker compose up -d postgres redis

# Windows (PowerShell)
docker-compose up -d postgres redis
```

Or start local database daemons:
- **PostgreSQL**: Listening on `localhost:5432` with user `postgres` and database `soter_dev`.
- **Redis**: Listening on `localhost:6379`.

---

### Step 2: Configure Environment Files

Copy default `.env.example` templates across all sub-services:

#### Backend (`app/backend/.env`)
```bash
cd app/backend
cp .env.example .env
```
Ensure key environment variables are set:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/soter_dev?schema=public"
REDIS_HOST="localhost"
REDIS_PORT=6379
JWT_SECRET="super-secret-dev-key-change-in-production-32chars"
AI_SERVICE_URL="http://localhost:8000"
SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
```

#### AI Service (`app/ai-service/.env`)
```bash
cd ../ai-service
cp .env.example .env
```
```env
PORT=8000
BACKEND_WEBHOOK_URL="http://localhost:3001/api/v1/webhooks/ai-verification"
```

#### Frontend (`app/frontend/.env.local`)
```bash
cd ../frontend
cp .env.example .env.local
```
```env
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

---

### Step 3: Initialize Database & Run Backend

```bash
# Navigate to backend directory
cd app/backend

# Install dependencies
npm install

# Run Prisma migrations & seed default data
npx prisma migrate dev --name init
npx prisma db seed

# Start NestJS backend in development watch mode
npm run start:dev
```
Backend API will start at: `http://localhost:3001` (Swagger docs at `http://localhost:3001/api/docs`).

---

### Step 4: Start AI Verification Service

```bash
cd app/ai-service

# Create and activate virtual environment
# Unix:
python3 -m venv venv
source venv/bin/activate

# Windows (PowerShell):
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install requirements & start uvicorn app
pip install -r requirements.txt
python main.py
```
AI Verification service will start at: `http://localhost:8000`.

---

### Step 5: Start Frontend UI

```bash
cd app/frontend

# Install dependencies & run Next.js dev server
npm install
npm run dev
```
Frontend Web Portal will start at: `http://localhost:3000`.

---

## 3. Running Test Suites

### Backend Unit & E2E Tests
```bash
cd app/backend

# Run unit tests
npm test

# Run end-to-end integration tests (includes Happy Path Demo)
npm run test:e2e
```

### Onchain Smart Contract Tests
```bash
cd app/onchain
cargo test --workspace
```

---

## 4. Common Failure Modes & Troubleshooting

| Error Symptom | Probable Cause | Resolution |
|---------------|----------------|------------|
| `Can't reach database server at localhost:5432` | PostgreSQL service not running or incorrect credentials | Run `docker ps` to verify container is healthy; check `DATABASE_URL` in `app/backend/.env`. |
| `Redis connection error: ECONNREFUSED 127.0.0.1:6379` | Redis server not running | Ensure Redis service is running on port 6379 (`redis-cli ping` should return `PONG`). |
| `CORS error in browser console` | Missing or mismatched origin config | Check `NEXT_PUBLIC_API_URL` in `app/frontend/.env.local` matches backend port `3001`. |
| `Prisma schema migration drift` | Database schema out of sync | Run `npx prisma migrate reset` in `app/backend` to recreate fresh schema. |
| `Python module not found` | Virtual environment not active | Activate virtualenv (`source venv/bin/activate` or `.\venv\Scripts\Activate.ps1`) before running `pip install`. |
