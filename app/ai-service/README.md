# Soter AI Service

FastAPI-based AI service layer for the Soter platform.

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and configure your API keys:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
- `OPENAI_API_KEY` - Your OpenAI API key (optional)
- `GROQ_API_KEY` - Your Groq API key (optional, alternative to OpenAI)

At least one API key is required for AI features.

### 3. Run the Service

**Development mode (with auto-reload):**

```bash
python main.py
```

Or using uvicorn directly:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Production mode:**

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

## API Endpoints

### Health Check
- **GET** `/health` - Service health status
- **GET** `/` - Service information

### Interactive Documentation
- **GET** `/docs` - Swagger UI (OpenAPI documentation)
- **GET** `/redoc` - ReDoc (alternative documentation)

## Project Structure

```
app/ai-service/
├── main.py              # Main application entry point
├── config.py            # Configuration and settings
├── requirements.txt     # Python dependencies
├── .env.example         # Environment variables template
├── .env                 # Environment variables (not in git)
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

Expected response:
```json
{
  "status": "healthy",
  "service": "soter-ai-service",
  "version": "0.1.0"
}
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines.
