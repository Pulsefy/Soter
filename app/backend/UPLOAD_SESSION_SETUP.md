# Resumable Evidence Upload - Setup Instructions

## Overview
The resumable evidence upload feature has been implemented. Follow these steps to complete the setup.

## Files Created/Modified

### New Files:
1. `src/evidence/dto/upload-session.dto.ts` - DTOs for upload session API
2. `src/evidence/upload-session.service.ts` - Service with chunk upload logic
3. `src/evidence/upload-session.controller.ts` - REST API endpoints
4. `prisma.config.ts` - Prisma 7 configuration

### Modified Files:
1. `prisma/schema.prisma` - Added UploadSession and UploadChunk models
2. `src/evidence/evidence.module.ts` - Integrated upload session components
3. `prisma/migrations/migration_lock.toml` - Updated provider to sqlite

## Setup Steps

### 1. Install Dependencies (if needed)
```bash
cd app/backend
npm install
```

### 2. Generate Prisma Client
The Prisma client needs to be regenerated to include the new models:

```bash
cd app/backend
npx prisma generate
```

### 3. Run Database Migration

**Option A: If using SQLite (development)**
```bash
cd app/backend
# Reset database and create fresh migration
npx prisma migrate reset --force
# Or create a new migration
npx prisma migrate dev --name add_upload_sessions
```

**Option B: If using PostgreSQL (production)**
Revert the provider change in `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then run:
```bash
cd app/backend
npx prisma migrate dev --name add_upload_sessions
```

### 4. Build the Project
```bash
cd app/backend
npm run build
```

### 5. Start the Server
```bash
cd app/backend
npm run start:dev
```

## API Endpoints

### 1. Create Upload Session
```
POST /evidence/upload-sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "evidence.pdf",
  "mimeType": "application/pdf",
  "totalSize": 10485760,
  "chunkSize": 5242880,  // optional, default 5MB
  "metadata": {           // optional
    "claimId": "claim_123"
  }
}
```

### 2. Upload Chunk
```
POST /evidence/upload-sessions/:sessionId/chunks
Authorization: Bearer <token>
Content-Type: multipart/form-data

Form Data:
- chunk: <binary file>
- chunkIndex: 0
- totalChunks: 5
- chunkHash: "sha256_hash_of_chunk"
```

### 3. Get Session Status
```
GET /evidence/upload-sessions/:sessionId
Authorization: Bearer <token>
```

### 4. Finalize Upload
```
POST /evidence/upload-sessions/:sessionId/finalize
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileHash": "sha256_hash_of_complete_file",
  "metadata": {            // optional
    "claimId": "claim_123",
    "category": "identity"
  }
}
```

### 5. Cancel Session
```
POST /evidence/upload-sessions/:sessionId/cancel
Authorization: Bearer <token>
```

## Client-Side Usage Example

```javascript
// 1. Create session
const createResponse = await fetch('/evidence/upload-sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    fileName: 'large_evidence.mp4',
    mimeType: 'video/mp4',
    totalSize: fileSize
  })
});

const session = await createResponse.json();
const { sessionId, chunkSize, totalChunks } = session;

// 2. Upload chunks
for (let i = 0; i < totalChunks; i++) {
  const start = i * chunkSize;
  const end = Math.min(start + chunkSize, fileSize);
  const chunk = file.slice(start, end);
  
  // Calculate chunk hash
  const chunkHash = await calculateSHA256(chunk);
  
  const formData = new FormData();
  formData.append('chunk', chunk);
  formData.append('chunkIndex', i);
  formData.append('totalChunks', totalChunks);
  formData.append('chunkHash', chunkHash);
  
  await fetch(`/evidence/upload-sessions/${sessionId}/chunks`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
}

// 3. Finalize
const fileHash = await calculateSHA256(file);
await fetch(`/evidence/upload-sessions/${sessionId}/finalize`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ fileHash })
});
```

## Features Implemented

✅ Upload session creation with validation
✅ Chunked upload with resume support
✅ Session state tracking (created → uploading → completed)
✅ Chunk ordering and integrity verification (SHA256)
✅ Upload expiry (24 hours default)
✅ Content type validation (whitelist)
✅ Size limits (100MB max)
✅ Ownership validation on all operations
✅ Automatic cleanup of expired sessions
✅ Encryption of assembled files
✅ Audit logging for all operations
✅ Integration with existing evidence queue

## Troubleshooting

### Prisma Client Generation Error
If you get errors about missing Prisma types:
```bash
cd app/backend
npx prisma generate
```

### Database Migration Error
If migrations fail due to provider mismatch:
1. Check `prisma/migrations/migration_lock.toml`
2. Ensure provider matches your database (sqlite or postgresql)
3. Reset migrations if needed: `npx prisma migrate reset`

### TypeScript Compilation Errors
Most errors are due to missing Prisma client types. Run:
```bash
npx prisma generate
npm run build
```

### Module Not Found Errors
Ensure all imports are correct and the evidence module includes the new components.

## Next Steps

1. Add unit tests for the upload session service
2. Add integration tests for the API endpoints
3. Implement frontend upload component with progress tracking
4. Add support for pause/resume in the UI
5. Configure cleanup job for expired sessions (cron job)
