# Soter AI Service

OCR service for identity document verification using Tesseract.

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
python main.py
```

Or using uvicorn directly:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## HMAC Authentication

All API endpoints (except `/health`, `/`, `/docs`, `/openapi.json`, `/redoc`) require HMAC-SHA256 signature authentication to ensure only authorized services can access the AI layer.

### Configuration

Set the shared secret key in your environment:

```bash
# Generate a secure key
openssl rand -hex 32

# Add to .env
HMAC_SECRET_KEY=your_generated_key_here
```

### Required Headers

| Header | Description |
|--------|-------------|
| `X-HMAC-Signature` | HMAC-SHA256 signature (hex-encoded) |
| `X-HMAC-Timestamp` | Unix timestamp (seconds since epoch) |

### Signature Generation

The signature is computed as:

```
HMAC-SHA256(secret_key, method + path + timestamp + body)
```

Where:
- `method`: HTTP method (GET, POST, etc.)
- `path`: Request path (e.g., `/ai/ocr`)
- `timestamp`: Unix timestamp as string
- `body`: Request body (empty string if no body)

### NestJS Backend Integration

Use the provided utility in the NestJS backend:

```typescript
import { generateHmacSignature } from './common/utils/hmac.util';

const body = JSON.stringify({ data: 'example' });
const headers = generateHmacSignature({
  method: 'POST',
  path: '/ai/ocr',
  body,
  secretKey: process.env.HMAC_SECRET_KEY,
});

// headers contains:
// {
//   'X-HMAC-Signature': '...',
//   'X-HMAC-Timestamp': '...'
// }

await fetch('http://ai-service:8000/ai/ocr', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...headers,
  },
  body,
});
```

### Signature Validation Rules

1. Requests without signature headers return `403 Forbidden`
2. Requests with invalid timestamp format return `403 Forbidden`
3. Requests older than 5 minutes (300 seconds) are rejected as expired
4. Requests with invalid signatures return `403 Forbidden`

## API

### Health Check
- **GET** `/health` - Service health status
- **GET** `/` - Service information

### Interactive Documentation
- **GET** `/docs` - Swagger UI (OpenAPI documentation)
- **GET** `/redoc` - ReDoc (alternative documentation)

### Proof-of-Life Verification
- **POST** `/ai/proof-of-life` - Face detection and liveness verification

Request body:

```json
{
  "selfie_image_base64": "<base64-image-or-data-uri>",
  "burst_images_base64": ["<base64-image>", "<base64-image>"],
  "confidence_threshold": 0.65
}
```

Response body:

```json
{
  "is_real_person": true,
  "confidence": 0.87,
  "threshold": 0.65,
  "checks": {
    "face_detected": true,
    "blink_detected": true,
    "head_movement_detected": false,
    "processed_burst_frames": 3
  },
  "reason": "Face detected and confidence threshold met"
}
```

### OCR Processing
- **POST** `/ai/ocr` - Identity document OCR with field extraction

### Humanitarian Verification
- **POST** `/ai/humanitarian/verify` - Standardized humanitarian claim verification (Sphere criteria + context factors + provider fallback)

Request body:

```json
{
  "aid_claim": "Relief teams delivered hygiene kits to all registered households in Sector B.",
  "supporting_evidence": ["Distribution list #B-17", "Field monitor report"],
  "context_factors": {
    "security_status": "stable",
    "weather": "heavy_rain",
    "displacement_level": "moderate"
  },
  "provider_preference": "auto"
}
```

Response body:

```json
{
  "success": true,
  "provider": "openai",
  "model": "gpt-4o-mini",
  "prompt_variant": "primary",
  "verification": {
    "verdict": "credible",
    "confidence": 0.86,
    "summary": "Evidence aligns with claim across key criteria"
  }
}
```

```bash
curl -X POST "http://localhost:8000/ai/ocr" -F "image=@document.jpg"
```

**Rate limit:** 10 requests/minute per IP

**Response:**

```json
{
  "success": true,
  "data": {
    "fields": {
      "name": { "value": "John Doe", "confidence": 0.91 },
      "date_of_birth": { "value": "15 Jan 1990", "confidence": 0.88 },
      "id_number": { "value": "AB123456", "confidence": 0.90 }
    },
    "raw_text": "...",
    "processing_time_ms": 950
  }
}
```

### PII Anonymization
- **POST** `/ai/anonymize` - Privacy-preserving anonymization for names, locations, and dates before external LLM usage

Request body:

```json
{
  "text": "On 15 Jan 2025, Mary Johnson received aid in Maiduguri Camp."
}
```

Response body:

```json
{
  "success": true,
  "anonymized_text": "On [EVENT_DATE], [RECIPIENT_NAME] received aid in [LOCATION].",
  "original_length": 60,
  "pii_summary": {
    "names": 1,
    "locations": 1,
    "dates": 1,
    "total": 3
  },
  "token_counts": {
    "[EVENT_DATE]": 1,
    "[RECIPIENT_NAME]": 1,
    "[LOCATION]": 1
  }
}
```

## Project Structure

```
app/ai-service/
├── main.py              # Main application entry point
├── config.py            # Configuration and settings
├── requirements.txt     # Python dependencies
├── .env.example         # Environment variables template
├── .env                 # Environment variables (not in git)
├── api/
│   └── routes.py       # OCR API routes
├── schemas/
│   └── ocr.py          # OCR Pydantic schemas
├── services/
│   ├── preprocessing.py # Image preprocessing
│   └── ocr.py           # OCR service
└── README.md           # This file
```

## Features

- ✅ FastAPI framework with async support
- ✅ Health check endpoint
- ✅ Environment variable management with pydantic-settings
- ✅ API key configuration for OpenAI/Groq
- ✅ Global error handling for HTTP exceptions
- ✅ Structured logging
- ✅ Auto-generated API documentation
- ✅ Startup/shutdown event handlers
- ✅ OpenCV face detection and basic liveness verification (blink/head movement)
- ✅ Tesseract OCR for identity document verification
- ✅ Image preprocessing (grayscale, thresholding, denoising)
- ✅ Field extraction with confidence scores
- ✅ Rate limiting (10 requests/minute)
- ✅ HMAC-SHA256 signature validation for inter-service authentication

## Development

### Adding New Routes

Create new route files and organize them by feature:

```python
# routes/aid.py
from fastapi import APIRouter

router = APIRouter(prefix="/aid", tags=["aid"])

@router.get("/")
async def get_aid_info():
    return {"service": "aid"}
```

Then include in `main.py`:

```python
from routes import aid
app.include_router(aid.router)
```

### Error Handling

The service includes global exception handlers:
- `HTTPException` - Returns formatted JSON responses for HTTP errors
- `Exception` - Catches unhandled exceptions and returns 500 error

All errors are logged with appropriate severity levels.

## Testing

Test the health endpoint:

```bash
curl http://localhost:8000/health
```

Run all tests:

```bash
pytest -v
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines.
