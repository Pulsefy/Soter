# Docker Deployment Guide for Soter AI Service

This guide provides comprehensive instructions for deploying the Soter AI Service using Docker with CUDA support.

## Prerequisites

- Docker Desktop installed and running
- NVIDIA Docker runtime (for GPU support)
- At least 4GB RAM available
- 10GB free disk space

## Build Stages

The Dockerfile includes multiple build stages for different use cases:

### 1. Development Stage
```bash
docker build -t soter-ai-service:dev --target development .
```
- Includes development dependencies
- Enables hot reloading with `--reload`
- Debug logging enabled
- Larger image size

### 2. Production Stage (CPU)
```bash
docker build -t soter-ai-service:latest --target production .
```
- Optimized for CPU deployment
- Uses `python:3.10-slim` base image
- Gunicorn with Uvicorn workers
- Smaller image size
- Production logging

### 3. Production Stage (GPU)
```bash
docker build -t soter-ai-service:gpu --target production-gpu .
```
- CUDA 12.1 runtime with GPU support
- Optimized for NVIDIA GPUs
- Reduced worker count for GPU memory management
- Hardware acceleration for AI models

## Quick Start

### Using Docker Compose (Recommended)

1. **Start the service stack:**
```bash
docker-compose up -d
```

2. **Check service health:**
```bash
curl http://localhost:8000/health
```

3. **View logs:**
```bash
docker-compose logs -f ai-service
```

4. **Stop the service:**
```bash
docker-compose down
```

### Using Docker Commands

1. **Build the image:**
```bash
docker build -t soter-ai-service:latest .
```

2. **Run with Redis:**
```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name ai-service -p 8000:8000 \
  --link redis:redis \
  -e REDIS_URL=redis://redis:6379/0 \
  soter-ai-service:latest
```

## GPU Deployment

### Prerequisites for GPU Support
- NVIDIA GPU with CUDA support
- NVIDIA Docker runtime installed
- Docker configured to use NVIDIA runtime

### GPU Deployment Steps

1. **Enable GPU support in Docker Desktop:**
   - Go to Docker Desktop Settings
   - Enable "Use GPU with Docker Desktop"
   - Restart Docker

2. **Build GPU image:**
```bash
docker build -t soter-ai-service:gpu --target production-gpu .
```

3. **Run with GPU:**
```bash
docker run -d --name ai-service-gpu \
  --gpus all \
  -p 8000:8000 \
  -e REDIS_URL=redis://host.docker.internal:6379/0 \
  soter-ai-service:gpu
```

4. **Or use Docker Compose with GPU profile:**
```bash
docker-compose --profile gpu up -d
```

## Environment Variables

### Required Variables
- `REDIS_URL`: Redis connection string (default: `redis://localhost:6379/0`)
- `BACKEND_WEBHOOK_URL`: Webhook URL for task completion notifications

### Optional Variables
- `APP_ENV`: Environment (development/production)
- `LOG_LEVEL`: Logging level (DEBUG/INFO/WARNING/ERROR)
- `OPENAI_API_KEY`: OpenAI API key for AI features
- `GROQ_API_KEY`: Groq API key as alternative to OpenAI
- `PROOF_OF_LIFE_CONFIDENCE_THRESHOLD`: Liveness detection threshold (0.0-1.0)
- `PROOF_OF_LIFE_MIN_FACE_SIZE`: Minimum face size in pixels

## Production Configuration

### Gunicorn Settings
- **Workers**: 4 (CPU), 2 (GPU)
- **Worker Class**: UvicornWorker
- **Bind**: 0.0.0.0:8000
- **Access Log**: stdout
- **Error Log**: stderr
- **Log Level**: info

### Health Checks
- **Endpoint**: `/health`
- **Interval**: 30 seconds
- **Timeout**: 30 seconds
- **Retries**: 3
- **Start Period**: 40 seconds

## Performance Optimization

### CPU Optimization
- Use `production` stage for smaller image size
- Adjust worker count based on CPU cores
- Monitor memory usage

### GPU Optimization
- Use `production-gpu` stage for CUDA acceleration
- Limit worker count to prevent GPU memory issues
- Monitor GPU utilization

### Resource Limits
```yaml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: '1.0'
    reservations:
      memory: 1G
      cpus: '0.5'
```

## Monitoring and Logging

### Application Logs
```bash
docker-compose logs -f ai-service
docker logs ai-service
```

### Health Monitoring
```bash
curl http://localhost:8000/health
```

### Metrics Endpoints
- `/health` - Service health status
- `/` - Service information
- `/docs` - API documentation (Swagger UI)

## Troubleshooting

### Common Issues

1. **Docker daemon not running**
   - Start Docker Desktop
   - Check Docker service status

2. **GPU not available**
   - Verify NVIDIA drivers are installed
   - Check NVIDIA Docker runtime
   - Test with `nvidia-smi`

3. **Port conflicts**
   - Change port mapping: `-p 8001:8000`
   - Check for running services on port 8000

4. **Memory issues**
   - Increase available RAM
   - Reduce worker count
   - Use smaller models

5. **Redis connection issues**
   - Ensure Redis is running
   - Check network connectivity
   - Verify REDIS_URL configuration

### Debug Commands

```bash
# Check container status
docker ps

# Inspect container
docker inspect ai-service

# Execute commands in container
docker exec -it ai-service bash

# Check resource usage
docker stats ai-service

# View container logs
docker logs ai-service
```

## Security Considerations

- Container runs as non-root user `soter`
- Environment variables should be managed securely
- Use secrets management for API keys
- Network isolation in production
- Regular security updates for base images

## Scaling

### Horizontal Scaling
```bash
docker-compose up -d --scale ai-service=3
```

### Load Balancing
Use external load balancer (nginx, HAProxy) to distribute traffic across multiple instances.

### Kubernetes Deployment
The Docker images are compatible with Kubernetes deployments. Use the appropriate image tag based on GPU requirements.

## Maintenance

### Image Updates
```bash
docker pull soter-ai-service:latest
docker-compose up -d --force-recreate
```

### Cleanup
```bash
docker system prune -f
docker volume prune -f
```

## Support

For issues related to:
- Docker deployment: Check this guide and Docker documentation
- AI service functionality: Review service logs and API documentation
- GPU issues: Verify NVIDIA drivers and CUDA installation
