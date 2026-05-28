Write-Host "Running pnpm install..."
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Error "pnpm install failed"; exit $LASTEXITCODE }

cd backend
Write-Host "Running prisma generate..."
pnpm prisma:generate
if ($LASTEXITCODE -ne 0) { Write-Error "prisma generate failed"; exit $LASTEXITCODE }

Write-Host "Running prisma migrate..."
pnpm prisma:migrate
if ($LASTEXITCODE -ne 0) { Write-Error "prisma migrate failed"; exit $LASTEXITCODE }

Write-Host "Starting backend server..."
pnpm start:dev
