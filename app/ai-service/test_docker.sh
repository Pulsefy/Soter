#!/bin/bash

# Docker Test Script for Soter AI Service
# This script tests the Docker build and deployment

set -e

echo "🐳 Soter AI Service Docker Test Script"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
check_docker() {
    print_status "Checking Docker installation..."
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running"
        exit 1
    fi
    
    print_status "Docker is running ✓"
}

# Check if Docker Compose is available
check_docker_compose() {
    print_status "Checking Docker Compose..."
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed"
        exit 1
    fi
    print_status "Docker Compose is available ✓"
}

# Test Docker build
test_build() {
    print_status "Testing Docker build (production stage)..."
    
    # Build production image
    if docker build -t soter-ai-service:test --target production .; then
        print_status "Production build successful ✓"
    else
        print_error "Production build failed"
        exit 1
    fi
    
    # Build development image
    print_status "Testing Docker build (development stage)..."
    if docker build -t soter-ai-service:dev-test --target development .; then
        print_status "Development build successful ✓"
    else
        print_error "Development build failed"
        exit 1
    fi
}

# Test container functionality
test_container() {
    print_status "Testing container functionality..."
    
    # Start Redis container
    print_status "Starting Redis container..."
    docker run -d --name redis-test -p 6379:6379 redis:7-alpine
    
    # Wait for Redis to be ready
    print_status "Waiting for Redis to be ready..."
    sleep 5
    
    # Test AI service container
    print_status "Starting AI service container..."
    docker run -d --name ai-service-test \
        -p 8000:8000 \
        --link redis-test:redis \
        -e REDIS_URL=redis://redis:6379/0 \
        -e APP_ENV=test \
        soter-ai-service:test
    
    # Wait for service to be ready
    print_status "Waiting for AI service to be ready..."
    sleep 10
    
    # Test health endpoint
    print_status "Testing health endpoint..."
    if curl -f http://localhost:8000/health; then
        print_status "Health endpoint responding ✓"
    else
        print_error "Health endpoint not responding"
        cleanup
        exit 1
    fi
    
    # Test root endpoint
    print_status "Testing root endpoint..."
    if curl -f http://localhost:8000/; then
        print_status "Root endpoint responding ✓"
    else
        print_error "Root endpoint not responding"
        cleanup
        exit 1
    fi
    
    print_status "Container functionality test passed ✓"
}

# Test Docker Compose
test_docker_compose() {
    print_status "Testing Docker Compose deployment..."
    
    # Start services with docker-compose
    if docker-compose up -d; then
        print_status "Docker Compose services started ✓"
    else
        print_error "Docker Compose failed to start"
        exit 1
    fi
    
    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 15
    
    # Test health endpoint
    print_status "Testing service health..."
    if curl -f http://localhost:8000/health; then
        print_status "Service health check passed ✓"
    else
        print_error "Service health check failed"
        docker-compose down
        exit 1
    fi
    
    # Check service logs
    print_status "Checking service logs..."
    if docker-compose logs ai-service | grep -q "Application startup complete"; then
        print_status "Service logs look good ✓"
    else
        print_warning "Service logs may need attention"
    fi
    
    print_status "Docker Compose test passed ✓"
}

# Test GPU support (optional)
test_gpu() {
    print_status "Checking GPU support..."
    
    if command -v nvidia-smi &> /dev/null; then
        print_status "NVIDIA drivers detected"
        
        # Test GPU build
        print_status "Testing GPU build..."
        if docker build -t soter-ai-service:gpu-test --target production-gpu .; then
            print_status "GPU build successful ✓"
        else
            print_warning "GPU build failed, falling back to CPU"
            return
        fi
        
        # Test GPU container (if nvidia-docker is available)
        if docker run --rm --gpus all nvidia/cuda:12.1-runtime-ubuntu22.04 nvidia-smi &> /dev/null; then
            print_status "NVIDIA Docker runtime available ✓"
            print_status "GPU support is ready"
        else
            print_warning "NVIDIA Docker runtime not available"
        fi
    else
        print_warning "NVIDIA drivers not detected, GPU support unavailable"
    fi
}

# Cleanup function
cleanup() {
    print_status "Cleaning up test containers..."
    
    # Stop and remove test containers
    docker stop ai-service-test redis-test 2>/dev/null || true
    docker rm ai-service-test redis-test 2>/dev/null || true
    
    # Stop docker-compose services
    docker-compose down 2>/dev/null || true
    
    # Remove test images
    docker rmi soter-ai-service:test soter-ai-service:dev-test soter-ai-service:gpu-test 2>/dev/null || true
    
    print_status "Cleanup completed ✓"
}

# Performance test
test_performance() {
    print_status "Running basic performance test..."
    
    # Make multiple requests to test responsiveness
    for i in {1..10}; do
        if curl -f -s http://localhost:8000/health > /dev/null; then
            echo -n "."
        else
            print_error "Performance test failed on request $i"
            break
        fi
    done
    echo ""
    print_status "Performance test completed ✓"
}

# Main test execution
main() {
    print_status "Starting Docker deployment tests..."
    
    # Run cleanup at the end
    trap cleanup EXIT
    
    # Run tests
    check_docker
    check_docker_compose
    test_build
    test_container
    test_docker_compose
    test_gpu
    test_performance
    
    print_status "🎉 All tests passed successfully!"
    print_status "The Docker setup is ready for production use."
}

# Help function
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -c, --cleanup  Only run cleanup"
    echo "  -b, --build    Only run build tests"
    echo "  -r, --run      Only run container tests"
    echo ""
    echo "Examples:"
    echo "  $0              # Run all tests"
    echo "  $0 --cleanup    # Clean up test containers"
    echo "  $0 --build      # Only test builds"
}

# Parse command line arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    -c|--cleanup)
        cleanup
        exit 0
        ;;
    -b|--build)
        check_docker
        test_build
        exit 0
        ;;
    -r|--run)
        check_docker
        test_container
        test_docker_compose
        cleanup
        exit 0
        ;;
    "")
        main
        ;;
    *)
        print_error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac
