#!/bin/bash

# Color codes
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Project Management App Deployment Script ===${NC}"

# Check if Docker is installed
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "Docker and Docker Compose found."
    echo "Building and starting the container..."
    
    # Build and run using docker-compose
    docker-compose up -d --build
    
    echo -e "${GREEN}Deployment successful!${NC}"
    echo "App is running at: http://localhost:8080"
    
else
    echo "Docker not found. Falling back to Node.js deployment."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo "Error: Node.js is not installed. Please install Node.js or Docker."
        exit 1
    fi
    
    echo "Installing dependencies..."
    npm install
    
    echo "Building the project..."
    npm run build
    
    echo "Starting server using 'serve'..."
    # Check if 'serve' is installed, if not install it locally or use npx
    if ! command -v serve &> /dev/null; then
        echo "'serve' package not found. Installing globally..."
        npm install -g serve
    fi
    
    # Run serve on port 8080 in background
    nohup serve -s dist -l 8080 > server.log 2>&1 &
    
    echo -e "${GREEN}Deployment successful!${NC}"
    echo "App is running at: http://localhost:8080"
    echo "Logs are being written to server.log"
fi
