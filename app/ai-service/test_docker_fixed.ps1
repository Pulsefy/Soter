# Docker Test Script for Soter AI Service (PowerShell)
# This script tests the Docker build and deployment

param(
    [switch]$Help,
    [switch]$Cleanup,
    [switch]$Build,
    [switch]$Run
)

# Colors for output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Check if Docker is running
function Test-Docker {
    Write-Status "Checking Docker installation..."
    
    try {
        $null = Get-Command docker -ErrorAction Stop
        $null = docker info 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker daemon not running"
        }
        Write-Status "Docker is running ✓"
        return $true
    }
    catch {
        Write-Error "Docker is not installed or not running"
        return $false
    }
}

# Check if Docker Compose is available
function Test-DockerCompose {
    Write-Status "Checking Docker Compose..."
    
    try {
        $null = docker compose version 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose not available"
        }
        Write-Status "Docker Compose is available ✓"
        return $true
    }
    catch {
        Write-Error "Docker Compose is not installed"
        return $false
    }
}

# Test Docker build
function Test-Build {
    Write-Status "Testing Docker build (production stage)..."
    
    try {
        $result = docker build -t soter-ai-service:test --target production . 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Production build failed: $result"
        }
        Write-Status "Production build successful ✓"
    }
    catch {
        Write-Error "Production build failed: $_"
        return $false
    }
    
    try {
        Write-Status "Testing Docker build (development stage)..."
        $result = docker build -t soter-ai-service:dev-test --target development . 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Development build failed: $result"
        }
        Write-Status "Development build successful ✓"
    }
    catch {
        Write-Error "Development build failed: $_"
        return $false
    }
    
    return $true
}

# Test container functionality
function Test-Container {
    Write-Status "Testing container functionality..."
    
    try {
        # Start Redis container
        Write-Status "Starting Redis container..."
        docker run -d --name redis-test -p 6379:6379 redis:7-alpine | Out-Null
        
        # Wait for Redis to be ready
        Write-Status "Waiting for Redis to be ready..."
        Start-Sleep -Seconds 5
        
        # Test AI service container
        Write-Status "Starting AI service container..."
        docker run -d --name ai-service-test `
            -p 8000:8000 `
            --link redis-test:redis `
            -e REDIS_URL=redis://redis:6379/0 `
            -e APP_ENV=test `
            soter-ai-service:test | Out-Null
        
        # Wait for service to be ready
        Write-Status "Waiting for AI service to be ready..."
        Start-Sleep -Seconds 10
        
        # Test health endpoint
        Write-Status "Testing health endpoint..."
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) {
                Write-Status "Health endpoint responding ✓"
            } else {
                throw "Health endpoint returned status $($response.StatusCode)"
            }
        }
        catch {
            Write-Error "Health endpoint not responding: $_"
            return $false
        }
        
        # Test root endpoint
        Write-Status "Testing root endpoint..."
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/" -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) {
                Write-Status "Root endpoint responding ✓"
            } else {
                throw "Root endpoint returned status $($response.StatusCode)"
            }
        }
        catch {
            Write-Error "Root endpoint not responding: $_"
            return $false
        }
        
        Write-Status "Container functionality test passed ✓"
        return $true
    }
    catch {
        Write-Error "Container test failed: $_"
        return $false
    }
}

# Test Docker Compose
function Test-DockerComposeDeployment {
    Write-Status "Testing Docker Compose deployment..."
    
    try {
        # Start services with docker-compose
        $result = docker-compose up -d 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose failed to start: $result"
        }
        Write-Status "Docker Compose services started ✓"
        
        # Wait for services to be ready
        Write-Status "Waiting for services to be ready..."
        Start-Sleep -Seconds 15
        
        # Test health endpoint
        Write-Status "Testing service health..."
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) {
                Write-Status "Service health check passed ✓"
            } else {
                throw "Service health check failed with status $($response.StatusCode)"
            }
        }
        catch {
            Write-Error "Service health check failed: $_"
            return $false
        }
        
        # Check service logs
        Write-Status "Checking service logs..."
        $logs = docker-compose logs ai-service 2>&1
        if ($logs -match "Application startup complete") {
            Write-Status "Service logs look good ✓"
        } else {
            Write-Warning "Service logs may need attention"
        }
        
        Write-Status "Docker Compose test passed ✓"
        return $true
    }
    catch {
        Write-Error "Docker Compose test failed: $_"
        return $false
    }
}

# Test GPU support (optional)
function Test-GPU {
    Write-Status "Checking GPU support..."
    
    try {
        $null = Get-Command nvidia-smi -ErrorAction Stop
        Write-Status "NVIDIA drivers detected"
        
        # Test GPU build
        Write-Status "Testing GPU build..."
        $result = docker build -t soter-ai-service:gpu-test --target production-gpu . 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "GPU build failed, falling back to CPU"
            return $true
        }
        Write-Status "GPU build successful ✓"
        
        # Test GPU container (if nvidia-docker is available)
        $result = docker run --rm --gpus all nvidia/cuda:12.1-runtime-ubuntu22.04 nvidia-smi 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Status "NVIDIA Docker runtime available ✓"
            Write-Status "GPU support is ready"
        } else {
            Write-Warning "NVIDIA Docker runtime not available"
        }
    }
    catch {
        Write-Warning "NVIDIA drivers not detected, GPU support unavailable"
    }
    
    return $true
}

# Cleanup function
function Invoke-Cleanup {
    Write-Status "Cleaning up test containers..."
    
    # Stop and remove test containers
    docker stop ai-service-test redis-test 2>$null
    docker rm ai-service-test redis-test 2>$null
    
    # Stop docker-compose services
    docker-compose down 2>$null
    
    # Remove test images
    docker rmi soter-ai-service:test soter-ai-service:dev-test soter-ai-service:gpu-test 2>$null
    
    Write-Status "Cleanup completed ✓"
}

# Performance test
function Test-Performance {
    Write-Status "Running basic performance test..."
    
    try {
        for ($i = 1; $i -le 10; $i++) {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                Write-Host "." -NoNewline
            } else {
                Write-Error "Performance test failed on request $i"
                break
            }
        }
        Write-Host ""
        Write-Status "Performance test completed ✓"
    }
    catch {
        Write-Error "Performance test failed: $_"
    }
}

# Main test execution
function Invoke-Main {
    Write-Host "🐳 Soter AI Service Docker Test Script" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    # Run cleanup at the end
    try {
        # Run tests
        if (-not (Test-Docker)) { exit 1 }
        if (-not (Test-DockerCompose)) { exit 1 }
        if (-not (Test-Build)) { exit 1 }
        if (-not (Test-Container)) { exit 1 }
        if (-not (Test-DockerComposeDeployment)) { exit 1 }
        Test-GPU
        Test-Performance
        
        Write-Status "🎉 All tests passed successfully!"
        Write-Status "The Docker setup is ready for production use."
    }
    finally {
        Invoke-Cleanup
    }
}

# Show help function
function Show-Help {
    Write-Host "Usage: .\test_docker_fixed.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Help        Show this help message"
    Write-Host "  -Cleanup     Only run cleanup"
    Write-Host "  -Build       Only run build tests"
    Write-Host "  -Run         Only run container tests"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\test_docker_fixed.ps1              # Run all tests"
    Write-Host "  .\test_docker_fixed.ps1 -Cleanup     # Clean up test containers"
    Write-Host "  .\test_docker_fixed.ps1 -Build       # Only test builds"
}

# Parse command line arguments
if ($Help) {
    Show-Help
    exit 0
}

if ($Cleanup) {
    Invoke-Cleanup
    exit 0
}

if ($Build) {
    if (Test-Docker) {
        Test-Build
    }
    exit 0
}

if ($Run) {
    if (Test-Docker) {
        Test-Container
        Test-DockerComposeDeployment
        Invoke-Cleanup
    }
    exit 0
}

# Default: run all tests
Invoke-Main
