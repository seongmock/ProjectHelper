#!/bin/bash

GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Starting Development Server ===${NC}"
echo "This mode allows hot-reloading. Changes will be reflected immediately."

if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "Running with Docker..."
    echo -e "${GREEN}App will be available at: http://localhost:8080${NC}"
    docker-compose -f docker-compose.dev.yml up
else
    echo "Docker not found. Running locally with npm..."
    if ! command -v node &> /dev/null; then
        echo "Error: Node.js is not installed."
        exit 1
    fi
    
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install
    fi
    
    echo "Starting Vite dev server..."
    npm run dev -- --host --port 8080
fi
