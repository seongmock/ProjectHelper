#!/bin/bash

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Project Management App Deployment Script ===${NC}"

# Check for Docker Compose (v1 or v2)
COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
fi

if [ -n "$COMPOSE_CMD" ] && command -v docker &> /dev/null; then
    echo "Docker detected. Starting HTTP service..."
    echo -e "${GREEN}For HTTPS (Clipboard support), use ./start_https.sh instead.${NC}"
    
    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Docker daemon is not running.${NC}"
        COMPOSE_CMD="" # Fallback
    else
        # Run standard HTTP docker-compose.yml
        echo "Building and starting containers..."
        if ! $COMPOSE_CMD up -d --build; then
            echo -e "${RED}Start failed. Retrying with cleanup...${NC}"
            $COMPOSE_CMD down --remove-orphans
            $COMPOSE_CMD up -d --build
        fi
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}Deployment successful!${NC}"
            echo -e "App is running at: ${GREEN}http://localhost:8080${NC} (or http://SERVER_IP:8080)"
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
echo -e "${RED}Note: Clipboard copy requires HTTPS. Currently running in HTTP mode (Download fallback active).${NC}"
