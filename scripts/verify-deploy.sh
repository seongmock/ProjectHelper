#!/bin/bash
# 배포 후 검증 — 실사에서 지적된 항목이 실제로 고쳐졌는지 운영 스택에 대고 확인한다.
# 전부 읽기 전용 검사다. 운영 데이터에 쓰기를 하지 않는다.
#
# 사용법: ./scripts/verify-deploy.sh [호스트]   (기본값: 로컬 IP 자동 탐지)
set -uo pipefail

HOST="${1:-$(hostname -I | awk '{print $1}')}"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

PASS=0; FAIL=0
ok()   { echo -e "  ${GREEN}✓${NC} $*"; PASS=$((PASS+1)); }
no()   { echo -e "  ${RED}✗${NC} $*"; FAIL=$((FAIL+1)); }
skip() { echo -e "  ${YELLOW}−${NC} $*"; }

d() { if docker info &>/dev/null; then docker "$@"; else sudo docker "$@"; fi; }

echo "=== ProjectHelper 배포 검증 (대상: $HOST) ==="

echo "[1] 컨테이너 상태"
for c in caddy-https project-management-app project-helper-api; do
    if [ "$(d inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
        ok "$c 실행 중"
    else
        no "$c 실행 중이 아님"
    fi
done

echo "[2] 인증 경계 (자격증명 없이 401이어야 한다)"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -k "https://$HOST/api/health" || echo 000)
[ "$code" = "401" ] && ok "GET /api/health → 401" || no "GET /api/health → $code (401 기대)"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -k "https://$HOST/" || echo 000)
[ "$code" = "401" ] && ok "GET / → 401" || no "GET / → $code (401 기대)"

echo "[3] API 컨테이너가 호스트에 직접 노출되지 않아야 한다"
if curl -s -o /dev/null -m 3 "http://$HOST:3000/api/health" 2>/dev/null; then
    body=$(curl -s -m 3 "http://$HOST:3000/api/health" | head -c 100)
    if echo "$body" | grep -q '"ok":true'; then
        no "포트 3000에서 ProjectHelper API가 직접 응답한다 (노출됨)"
    else
        ok "포트 3000은 다른 서비스 (ProjectHelper API 아님)"
    fi
else
    ok "포트 3000 미개방"
fi

echo "[4] NODE_ENV=production (스택트레이스 유출 차단)"
env_val=$(d exec project-helper-api sh -c 'echo $NODE_ENV' 2>/dev/null | tr -d '\r')
[ "$env_val" = "production" ] && ok "NODE_ENV=production" || no "NODE_ENV='$env_val' (production 기대)"

echo "[5] 에러 응답에 스택트레이스가 없어야 한다"
body=$(d exec project-helper-api node -e '
const req=require("http").request({host:"localhost",port:3000,path:"/api/health",method:"GET"},res=>{
  let d="";res.on("data",c=>d+=c);res.on("end",()=>{process.stdout.write(d)})});
req.on("error",()=>process.exit(1));req.end()' 2>/dev/null)
if echo "$body" | grep -q '"ok":true'; then
    ok "헬스 엔드포인트 정상 응답"
else
    no "헬스 엔드포인트 응답 이상: $body"
fi
# 잘못된 JSON → 스택 미노출 확인 (읽기 전용 경로가 없어 GET 404로 대체 검증)
body=$(d exec project-helper-api node -e '
require("http").get({host:"localhost",port:3000,path:"/api/does-not-exist"},res=>{
  let d="";res.on("data",c=>d+=c);res.on("end",()=>process.stdout.write(d))})' 2>/dev/null)
if echo "$body" | grep -qiE "at .*node_modules|SyntaxError|/app/"; then
    no "404 응답에 내부 경로가 노출된다: $(echo "$body" | head -c 120)"
else
    ok "404 응답에 내부 경로 없음"
fi

echo "[6] non-root 실행"
whoami_val=$(d exec project-helper-api whoami 2>/dev/null | tr -d '\r')
[ "$whoami_val" = "node" ] && ok "API가 'node' 사용자로 실행" || no "API가 '$whoami_val' 로 실행 (node 기대)"

echo "[7] Node 런타임 버전 (18은 EOL)"
nv=$(d exec project-helper-api node -v 2>/dev/null | tr -d '\r')
case "$nv" in
    v22.*|v24.*) ok "Node $nv" ;;
    *)           no "Node $nv (22 LTS 이상 기대)" ;;
esac

echo "[8] 정적 자산 압축"
# index.html(약 750B)은 gzip_min_length(1024) 미달이라 압축되지 않는 것이 정상이다.
# 실제 효과가 큰 JS 번들(약 307KB)로 검사해야 의미가 있다.
asset=$(d exec project-management-app sh -c 'ls /usr/share/nginx/html/assets/*.js 2>/dev/null | head -1 | xargs -r basename')
if [ -n "$asset" ]; then
    hdrs=$(d exec caddy-https sh -c "wget -S -qO /dev/null --header='Accept-Encoding: gzip' http://project-management-app:80/assets/$asset 2>&1")
    echo "$hdrs" | grep -qi "content-encoding.*gzip" && ok "nginx gzip 적용 ($asset)" || no "nginx gzip 미적용 ($asset)"
else
    skip "자산 파일을 찾지 못해 건너뜀"
fi

echo "[9] 자산 캐시 헤더"
if [ -n "$asset" ]; then
    hdrs=$(d exec caddy-https sh -c "wget -S -qO /dev/null http://project-management-app:80/assets/$asset 2>&1")
    echo "$hdrs" | grep -qi "immutable" && ok "자산에 immutable 캐시 헤더 적용" || no "자산 캐시 헤더 없음"
else
    skip "자산 파일을 찾지 못해 건너뜀"
fi

echo "[10] 보안 헤더 (Caddy)"
# 주의: basic_auth 의 401 응답에는 header 블록이 적용되지 않는다(Caddy 동작, route 로도
# 바뀌지 않음). 401은 본문이 없어 문제가 아니지만, 그래서 검사는 반드시 '인증된 200
# 응답'에 대고 해야 한다. 401을 검사하면 항상 실패하는 무의미한 테스트가 된다.
if [ -n "${PH_VERIFY_USER:-}" ] && [ -n "${PH_VERIFY_PASS:-}" ]; then
    hdrs=$(curl -s -D - -o /dev/null -m 5 -k -u "$PH_VERIFY_USER:$PH_VERIFY_PASS" "https://$HOST/" 2>/dev/null)
    if echo "$hdrs" | grep -qiE "^HTTP.* 200"; then
        ok "인증 성공 (200) — .env 자격증명이 정상 동작"
        for h in "x-content-type-options" "x-frame-options" "content-security-policy" "referrer-policy"; do
            echo "$hdrs" | grep -qi "^$h:" && ok "$h 존재" || no "$h 없음"
        done
        echo "$hdrs" | grep -qi "^server:" \
            && no "Server 헤더가 남아 있다" \
            || ok "Server 헤더 제거됨"
        echo "$hdrs" | grep -qi "^strict-transport-security:" \
            && no "HSTS가 켜져 있다 — 자체서명 인증서 환경에서는 접속 불가를 유발한다" \
            || ok "HSTS 미적용 (자체서명 환경에서 의도된 설정)"
    else
        no "인증 실패 — .env 의 BASIC_AUTH_USER/HASH 또는 전달한 자격증명을 확인하라"
    fi
else
    skip "보안 헤더 검사 건너뜀 — 다음처럼 자격증명을 주면 검사한다:"
    skip "  PH_VERIFY_USER=<사용자> PH_VERIFY_PASS=<비밀번호> $0 $HOST"
fi

echo "[11] 자격증명이 VCS에 없어야 한다"
grep -qE '\$2[aby]\$' Caddyfile 2>/dev/null \
    && no "Caddyfile에 bcrypt 해시가 남아 있다" \
    || ok "Caddyfile에 해시 리터럴 없음"
git check-ignore -q .env 2>/dev/null && ok ".env 가 gitignore 처리됨" || no ".env 가 추적될 수 있다"

echo "[12] 백업 최신성"
latest=$(find backups -name 'ph-data-*.tar.gz' -mtime -2 2>/dev/null | head -1)
[ -n "$latest" ] && ok "48시간 내 백업 존재: $(basename "$latest")" || no "최근 백업 없음 — ./scripts/backup-data.sh 실행"

echo
echo "───────────────────────────────"
echo -e "통과 ${GREEN}$PASS${NC} / 실패 ${RED}$FAIL${NC}"
[ "$FAIL" -eq 0 ] || exit 1
