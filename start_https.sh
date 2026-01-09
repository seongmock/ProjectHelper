#!/bin/bash

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== Project Management App (HTTPS Mode) ===${NC}"

# Check for Docker Compose (v1 or v2)
COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
fi

if [ -n "$COMPOSE_CMD" ] && command -v docker &> /dev/null; then
    echo "Docker detected. Configuring HTTPS service with Caddy..."
    
    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Docker daemon is not running.${NC}"
        exit 1
    else
        echo "Building and starting containers (App + Caddy)..."
        
        # We use docker-compose.https.yml which includes Caddy
        if ! $COMPOSE_CMD -f docker-compose.https.yml up -d --build; then
            echo -e "${RED}Start failed. Retrying with cleanup...${NC}"
            $COMPOSE_CMD -f docker-compose.https.yml down --remove-orphans
            $COMPOSE_CMD -f docker-compose.https.yml up -d --build
        fi
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}Deployment successful!${NC}"
            echo -e "App is running at: ${GREEN}https://YOUR_SERVER_IP${NC} (Port 443)"
            echo "Note: Accept the security warning as this uses a self-signed internal certificate."
            exit 0
        fi
    fi
else
    echo -e "${RED}Error: Docker is required for automated HTTPS deployment.${NC}"
    echo "Please install Docker or use ./start_server.sh for HTTP mode."
    exit 1
fi
