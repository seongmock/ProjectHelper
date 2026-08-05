#!/bin/bash
# ProjectHelper 배포 스크립트.
#
# 배포 전에 반드시 데이터 백업을 수행한다 (2026-08-05 데이터 소실 사고 재발 방지).
# 주의: 어떤 경로에서도 `down -v` 를 쓰지 않는다 — api_data 볼륨에 운영 데이터가 있다.
set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
fail() { echo -e "${RED}[deploy] $*${NC}" >&2; }

cd "$(dirname "${BASH_SOURCE[0]}")"

echo -e "${GREEN}=== ProjectHelper Deployment ===${NC}"

DEV_MODE=false
if [ "${1:-}" == "--dev" ]; then
    DEV_MODE=true
    warn "개발 모드(hot-reload). vite dev 서버가 노출되므로 운영 용도로 쓰지 말 것."
fi

# ── Docker Compose 탐지 ──────────────────────────────
COMPOSE_CMD=""
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
fi

DOCKER_OK=false
if [ -n "$COMPOSE_CMD" ] && command -v docker &> /dev/null && sudo docker info &> /dev/null; then
    DOCKER_OK=true
fi

if [ "$DOCKER_OK" = true ]; then
    # ── 사전 점검: .env ─────────────────────────────
    if [ ! -f .env ]; then
        fail ".env 파일이 없다. 인증 정보 없이는 기동할 수 없다."
        fail "  cp .env.example .env  후 BASIC_AUTH_USER / BASIC_AUTH_HASH 를 채워라."
        fail "  해시 생성: docker run --rm caddy:2.10-alpine caddy hash-password --plaintext '비밀번호'"
        exit 1
    fi
    if ! grep -q '^BASIC_AUTH_HASH=.\+' .env; then
        fail ".env 의 BASIC_AUTH_HASH 가 비어 있다."
        exit 1
    fi

    # ── 배포 전 백업 (필수) ─────────────────────────
    if sudo docker volume inspect projecthelper_api_data &> /dev/null; then
        info "배포 전 데이터 백업 중..."
        if ! ./scripts/backup-data.sh; then
            fail "백업 실패. 백업 없이 배포하지 않는다."
            exit 1
        fi
    else
        info "api_data 볼륨이 아직 없다 (최초 배포) — 백업 생략."
    fi

    # ── 볼륨 소유권 마이그레이션 (멱등, up 이전에 수행) ──
    # API 컨테이너는 non-root(uid 1000)로 실행된다. non-root 전환 전에 만들어진
    # 볼륨 파일은 root 소유라 그대로 두면 쓰기가 실패한다.
    # 반드시 `up` 보다 먼저 해야 한다 — caddy 가 api 의 healthy 를 기다리므로,
    # api 가 못 뜨면 up 자체가 실패하고 그 이후 단계는 실행되지 않는다.
    if sudo docker volume inspect projecthelper_api_data &> /dev/null; then
        OWNER=$(sudo docker run --rm -v projecthelper_api_data:/data alpine:3.20 stat -c '%u' /data)
        if [ "$OWNER" != "1000" ]; then
            info "데이터 볼륨 소유권 조정: uid $OWNER → 1000"
            sudo docker run --rm -v projecthelper_api_data:/data alpine:3.20 chown -R 1000:1000 /data
        fi
    fi

    COMPOSE_FILES="-f docker-compose.yml"
    if [ "$DEV_MODE" = true ]; then
        COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"
    fi

    # 다른 모드에서 남은 컨테이너 정리 (-v 금지)
    sudo $COMPOSE_CMD down --remove-orphans &> /dev/null || true

    info "컨테이너 빌드 및 기동..."
    if ! sudo $COMPOSE_CMD $COMPOSE_FILES up -d --build; then
        fail "기동 실패. 정리 후 재시도한다."
        sudo $COMPOSE_CMD $COMPOSE_FILES down --remove-orphans
        if ! sudo $COMPOSE_CMD $COMPOSE_FILES up -d --build; then
            fail "재시도도 실패. 백업은 backups/ 에 남아 있다."
            exit 1
        fi
    fi

    # ── 헬스 게이트 ─────────────────────────────────
    info "API 헬스체크 대기..."
    HEALTHY=false
    for _ in $(seq 1 30); do
        if sudo docker exec project-helper-api node -e \
            "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
            HEALTHY=true
            break
        fi
        sleep 2
    done

    if [ "$HEALTHY" != true ]; then
        fail "API가 정상 응답하지 않는다. 로그를 확인하라:"
        fail "  sudo docker logs --tail 50 project-helper-api"
        fail "복구가 필요하면: ./scripts/backup-data.sh --list 후 --restore <아카이브>"
        exit 1
    fi

    info "배포 완료 — https://localhost (또는 https://SERVER_IP)"
    info "배포 검증: ./scripts/verify-deploy.sh"
    [ "$DEV_MODE" = true ] && warn "개발 모드 활성: 소스 변경이 즉시 반영된다."
    exit 0
fi

# ── 폴백: 로컬 Node 정적 서빙 (HTTP, 인증 없음) ─────
warn "Docker를 사용할 수 없다. 로컬 Node 정적 서빙으로 폴백한다."
warn "이 모드에는 인증도 API 서버도 없다 — 임시 확인 용도로만 쓸 것."

command -v node &> /dev/null || { fail "Node.js가 설치되어 있지 않다."; exit 1; }

info "의존성 설치..."
npm ci || npm install

info "빌드..."
npm run build || { fail "빌드 실패"; exit 1; }

pkill -f "serve -s dist" || true
nohup npx --yes serve -s dist -l 8080 > serve.log 2>&1 &

info "http://localhost:8080 에서 실행 중 (로그: serve.log)"
