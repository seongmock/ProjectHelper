#!/bin/bash

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Starting Development Server ===${NC}"
echo "This mode allows hot-reloading. Changes will be reflected immediately."

# Check for Docker Compose (v1 or v2)
COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
fi

if [ -n "$COMPOSE_CMD" ] && command -v docker &> /dev/null; then
    echo "Docker detected. Running with $COMPOSE_CMD..."
    echo -e "${GREEN}App will be available at: http://localhost:8090${NC}"
    
    # Check if docker daemon is running
    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Docker daemon is not running.${NC}"
        echo "Falling back to local Node.js..."
        COMPOSE_CMD=""
    else
        echo "Starting Docker containers..."
        # Use separate project name (-p project-helper-dev) to avoid conflict with production server
        if ! $COMPOSE_CMD -p project-helper-dev -f docker-compose.dev.yml up; then
            echo -e "${RED}Docker start failed. Attempting to clean up stale resources and retry...${NC}"
            $COMPOSE_CMD -p project-helper-dev -f docker-compose.dev.yml down --remove-orphans
            $COMPOSE_CMD -p project-helper-dev -f docker-compose.dev.yml up
        fi
    fi
fi

# Fallback to local Node.js if Docker is not available or failed
if [ -z "$COMPOSE_CMD" ]; then
    echo "Running locally with npm..."
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js is not installed.${NC}"
        exit 1
    fi
    
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install
    fi
    
    echo "Starting Vite dev server..."
    # Note: If port 8090 is irrelevant for you locally, remove --port 8090
    npm run dev -- --host --port 8090
fi
