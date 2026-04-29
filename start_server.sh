#!/bin/bash

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Project Management App Deployment Script ===${NC}"

# Check for --dev flag
DEV_MODE=false
if [ "$1" == "--dev" ]; then
    DEV_MODE=true
    echo -e "${GREEN}Running in Development Mode (Hot-Reload Enabled)${NC}"
fi

# Check for Docker Compose (v1 or v2)
COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
fi

if [ -n "$COMPOSE_CMD" ] && command -v docker &> /dev/null; then
    echo "Docker detected. Starting service..."
    
    if ! sudo docker info &> /dev/null; then
        echo -e "${RED}Error: Docker daemon is not running.${NC}"
        COMPOSE_CMD="" # Fallback
    else
        # Determine compose files
        COMPOSE_FILES="-f docker-compose.yml"
        if [ "$DEV_MODE" = true ]; then
            COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"
        fi
        
        # Clean up any orphan containers from other modes
        sudo $COMPOSE_CMD down -v --remove-orphans &> /dev/null || true
        
        echo "Building and starting containers..."
        if ! sudo $COMPOSE_CMD $COMPOSE_FILES up -d --build; then
            echo -e "${RED}Start failed. Retrying with cleanup...${NC}"
            sudo $COMPOSE_CMD $COMPOSE_FILES down --remove-orphans
            sudo $COMPOSE_CMD $COMPOSE_FILES up -d --build
        fi
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}Deployment successful!${NC}"
            echo -e "App is running at: ${GREEN}https://localhost${NC} (or https://SERVER_IP)"
            if [ "$DEV_MODE" = true ]; then
                echo "Development mode active: Source code changes will hot-reload automatically."
            fi
            exit 0
        fi
    fi
fi

# Fallback to Node.js Deployment (HTTP Only)
echo "Falling back to local Node.js deployment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed. Please install Node.js or Docker.${NC}"
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
# Kill previous instance if any (optional but good for reload)
pkill -f "serve -s dist" || true

nohup serve -s dist -l 8080 > server.log 2>&1 &

echo -e "${GREEN}Deployment successful!${NC}"
echo "App is running at: http://localhost:8080"
echo "Logs are being written to server.log"
