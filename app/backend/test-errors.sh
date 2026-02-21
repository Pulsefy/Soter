#!/bin/bash

echo "Testing Global Error Handling Implementation"
echo "============================================"

# Wait for the server to start
echo "Waiting for server to start..."
sleep 5

echo ""
echo "1. Testing Generic Error:"
curl -i -X GET http://localhost:3000/api/v1/test-error/generic-error
echo -e "\n"

echo "2. Testing Bad Request Error:"
curl -i -X GET http://localhost:3000/api/v1/test-error/bad-request
echo -e "\n"

echo "3. Testing Validation Error:"
curl -i -X POST http://localhost:3000/api/v1/test-error/validation-error \
  -H "Content-Type: application/json" \
  -d '{"invalidField": "invalid"}'
echo -e "\n"

echo "4. Testing Prisma Error Simulation:"
curl -i -X GET http://localhost:3000/api/v1/test-error/prisma-error-simulation
echo -e "\n"

echo "5. Testing with custom Request ID:"
curl -i -X GET http://localhost:3000/api/v1/test-error/bad-request \
  -H "X-Request-ID: CUSTOM-TEST-ID"
echo -e "\n"

echo "All tests completed!"