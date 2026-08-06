#!/bin/bash
# HTTPS Basic 인증 비밀번호 교체.
#
# 배경: 2026-08-05 실사에서 Caddyfile 에 하드코딩돼 있던 사용자명과 bcrypt 해시가
#       공개 저장소 git 이력에 남아 있음을 확인했다. 파일에서 지우는 것만으로는
#       이력에서 제거되지 않으므로 비밀번호 실물 교체가 유일하게 확실한 대응이다.
#
# 설계 원칙: 비밀번호를 인자로 받지 않는다.
#   - 명령행 인자는 셸 히스토리와 `ps` 출력에 남는다
#   - 입력은 화면에 표시하지 않고(read -s), 로그에도 남기지 않는다
#
# 사용법:
#   ./scripts/rotate-password.sh              # 비밀번호를 직접 입력 (권장)
#   ./scripts/rotate-password.sh --generate   # 강한 임의 비밀번호를 생성해 1회 출력
#   ./scripts/rotate-password.sh --user <이름> # 사용자명도 함께 변경
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[rotate]${NC} $*"; }
warn() { echo -e "${YELLOW}[rotate]${NC} $*"; }
die()  { echo -e "${RED}[rotate] $*${NC}" >&2; exit 1; }

ENV_FILE=".env"
MIN_LEN=12
GENERATE=false
NEW_USER=""

while [ $# -gt 0 ]; do
    case "$1" in
        --generate) GENERATE=true; shift ;;
        --user)     NEW_USER="${2:-}"; [ -n "$NEW_USER" ] || die "--user 뒤에 사용자명이 필요하다"; shift 2 ;;
        *)          die "알 수 없는 옵션: $1" ;;
    esac
done

d() { if docker info &>/dev/null; then docker "$@"; else sudo docker "$@"; fi; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE 이 없다. cp .env.example .env 부터 하라."

CUR_USER=$(grep -E '^BASIC_AUTH_USER=' "$ENV_FILE" | cut -d= -f2-)
USER_NAME="${NEW_USER:-$CUR_USER}"
[ -n "$USER_NAME" ] || die "BASIC_AUTH_USER 를 결정할 수 없다."

# ── 비밀번호 확보 ────────────────────────────────────
if [ "$GENERATE" = true ]; then
    # 셸 특수문자를 피해 오탈자·이스케이프 사고를 줄인다
    PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
    warn "생성된 비밀번호 (지금 저장하라 — 다시 표시되지 않는다):"
    echo
    echo "    $PASSWORD"
    echo
else
    read -r -s -p "새 비밀번호 (표시되지 않음): " PASSWORD; echo
    read -r -s -p "다시 입력: " CONFIRM; echo
    [ "$PASSWORD" = "$CONFIRM" ] || die "두 입력이 일치하지 않는다."
    unset CONFIRM
fi

[ ${#PASSWORD} -ge $MIN_LEN ] || die "비밀번호는 최소 ${MIN_LEN}자 이상이어야 한다."

# ── 해시 생성 ────────────────────────────────────────
# `caddy hash-password --plaintext "$PW"` 는 쓰지 않는다 — 비밀번호가 argv 에 들어가
# 호스트의 `ps` 출력과 docker 컨테이너 설정에 노출된다.
# `caddy hash-password` 의 stdin 입력은 TTY 프롬프트를 요구해 파이프로는 EOF 로 실패한다.
# htpasswd -i 는 stdin 에서 읽으므로 argv 노출이 없다.
# Caddy 가 htpasswd 의 $2y$ 해시를 그대로 받는 것은 실측 확인했다(오답은 401로 거부).
info "bcrypt 해시 생성 중..."
if command -v htpasswd &>/dev/null; then
    HASH=$(printf '%s' "$PASSWORD" | htpasswd -niBC 14 "$USER_NAME" 2>/dev/null | cut -d: -f2 | tr -d '\r\n')
else
    HASH=$(printf '%s' "$PASSWORD" | d run --rm -i httpd:2.4-alpine \
        htpasswd -niBC 14 "$USER_NAME" 2>/dev/null | cut -d: -f2 | tr -d '\r\n')
fi

case "$HASH" in
    \$2[aby]\$*) ;;
    *) die "해시 생성 실패 (받은 값: '${HASH:0:20}')" ;;
esac
[ ${#HASH} -ge 55 ] || die "해시 길이가 비정상이다 (${#HASH}자)"

# ── .env 갱신 (원자적 + 백업) ────────────────────────
BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$BACKUP"
info "기존 .env 백업: $BACKUP"

TMP=$(mktemp)
# 해시에 $ 가 들어 있어 sed 치환은 위험하다 — 값을 변수로 넘겨 awk 로 처리한다
awk -v u="$USER_NAME" -v h="$HASH" '
    /^BASIC_AUTH_USER=/ { print "BASIC_AUTH_USER=" u; seen_u=1; next }
    /^BASIC_AUTH_HASH=/ { print "BASIC_AUTH_HASH=" h; seen_h=1; next }
    { print }
    END {
        if (!seen_u) print "BASIC_AUTH_USER=" u
        if (!seen_h) print "BASIC_AUTH_HASH=" h
    }
' "$ENV_FILE" > "$TMP" && mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ── 적용 ─────────────────────────────────────────────
# Caddyfile 은 볼륨 마운트이고 자격증명은 환경변수이므로 컨테이너 재생성이 필요하다.
# 주의: docker-compose v1.29.2 의 `--force-recreate <서비스>` 는 최신 Docker Engine 에서
#       KeyError 로 죽으면서 컨테이너를 rename+정지시킨다. 전체 up 을 쓴다.
info "Caddy 에 적용 중..."
COMPOSE=""
if d compose version &>/dev/null; then COMPOSE="compose"; fi

if [ -n "$COMPOSE" ]; then
    d compose up -d caddy >/dev/null 2>&1
else
    sudo docker-compose up -d >/dev/null 2>&1
fi
sleep 3

# ── 검증 ─────────────────────────────────────────────
HOST=$(hostname -I | awk '{print $1}')
info "검증 중 (대상: $HOST)..."

CODE_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" -m 8 -k "https://$HOST/" 2>/dev/null)
CODE_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -m 8 -k -u "$USER_NAME:$PASSWORD" "https://$HOST/" 2>/dev/null)
unset PASSWORD

if [ "$CODE_NOAUTH" = "401" ] && [ "$CODE_AUTH" = "200" ]; then
    info "교체 완료 — 자격증명 없이 401, 새 자격증명으로 200 확인"
    info "사용자명: $USER_NAME"
    warn "이전 .env 백업($BACKUP)에는 옛 해시가 들어 있다. 확인 후 삭제하라:"
    warn "  rm $BACKUP"
    exit 0
fi

# ── 실패 시 롤백 ─────────────────────────────────────
echo
die_msg="검증 실패 (인증 없이=$CODE_NOAUTH, 새 자격증명=$CODE_AUTH / 기대: 401, 200)"
echo -e "${RED}[rotate] $die_msg${NC}" >&2
warn "이전 .env 로 롤백한다..."
cp -p "$BACKUP" "$ENV_FILE"
if [ -n "$COMPOSE" ]; then
    d compose up -d caddy >/dev/null 2>&1
else
    sudo docker-compose up -d >/dev/null 2>&1
fi
sleep 3
ROLLBACK_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 8 -k "https://$HOST/" 2>/dev/null)
warn "롤백 완료 (현재 응답: $ROLLBACK_CODE). 이전 비밀번호가 다시 유효하다."
warn "Caddy 로그: sudo docker logs --tail 30 caddy-https"
exit 1
