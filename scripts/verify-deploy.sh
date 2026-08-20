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

# 인증이 켜져 있는지 **Caddyfile 에서 읽어** 판정한다. 하드코딩하면 basicauth 를 붙이거나
# 떼는 순간 이 스크립트가 통째로 거짓말을 한다 — 2026-08-18 에 사용자 결정으로 인증을
# 일시 제거했고, 그때 [2]·[10] 이 전부 실패로 뒤집혔다. 어느 쪽 상태든 의도대로인지를 본다.
AUTH_ON=false
grep -qE '^[[:space:]]*basic_auth[[:space:]]' Caddyfile 2>/dev/null && AUTH_ON=true

echo "=== ProjectHelper 배포 검증 (대상: $HOST) ==="
if [ "$AUTH_ON" = true ]; then
    echo "    인증: basicauth 활성 (Caddyfile 기준) — 앱 계정 인증 검사는 자격증명이 필요해 생략"
else
    echo -e "    인증: ${YELLOW}없음 — 의도된 일시 상태${NC} (Caddyfile 주석 참조. 개선 완료 후 복구)"
fi

echo "[1] 컨테이너 상태"
for c in caddy-https project-management-app project-helper-api; do
    if [ "$(d inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
        ok "$c 실행 중"
    else
        no "$c 실행 중이 아님"
    fi
done

echo "[2] 인증 경계"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -k "https://$HOST/api/health" || echo 000)
[ "$code" = "200" ] && ok "GET /api/health → 200" || no "GET /api/health → $code (200 기대)"

if [ "$AUTH_ON" = true ]; then
    # /api/health 는 @needs_auth 매처로 인증에서 제외돼 있다 — 자격증명 없이도 검사할 수 있는
    # 200 응답을 하나 두기 위한 것이다([10] 참조). 그래서 이 검사의 핵심은 "헬스가 200" 이
    # 아니라 **다른 경로는 전부 401** 이라는 쪽이다. 매처가 넓어지면 여기서 걸린다.
    for p in "/" "/api/projects" "/api/tasks" "/api/data" "/api/settings" "/api/health/"; do
        code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -k "https://$HOST$p" || echo 000)
        [ "$code" = "401" ] && ok "GET $p → 401" || no "GET $p → $code (401 기대 — 인증 제외가 새고 있다)"
    done
else
    # 인증이 없는 상태 — 열려 있는 것이 의도다. 그래도 검사는 한다: 응답이 오는지(=경로가
    # 살아 있는지)와, **401 이 남아 있지 않은지**(설정이 반만 적용된 상태를 잡는다).
    for p in "/" "/api/projects" "/api/tasks" "/api/settings"; do
        code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -k "https://$HOST$p" || echo 000)
        case "$code" in
            200) ok "GET $p → 200 (인증 없음 — 의도된 상태)" ;;
            401) no "GET $p → 401 — Caddyfile 은 인증 없음인데 응답은 401 (재시작 누락?)" ;;
            *)   no "GET $p → $code (200 기대)" ;;
        esac
    done
    # 앱 계정 인증(P3-3)은 Caddy basicauth 와 **다른 층**이다. 하나가 꺼져 있다고 다른
    # 하나까지 꺼져 있다고 단정하면 안 되므로, 상태를 응답에서 직접 읽는다.
    mode=$(curl -s -m 5 -k "https://$HOST/api/auth/me" | grep -o '"mode":"[a-z]*"' | cut -d'"' -f4)
    case "$mode" in
        open) ok "앱 계정 인증: 꺼짐 (계정 없음 — 화면의 [계정] 에서 첫 관리자를 만들면 켜진다)" ;;
        enforced)
            code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -k "https://$HOST/api/tasks" || echo 000)
            [ "$code" = "401" ] && ok "앱 계정 인증: 켜짐 — 익명 GET /api/tasks → 401" \
                || no "앱 계정 인증이 켜져 있는데 익명 GET /api/tasks → $code (401 기대)"
            ;;
        *) no "/api/auth/me 가 mode 를 말하지 않는다 ('$mode') — 인증 계층 상태를 알 수 없다" ;;
    esac

    # 인증을 되살릴 때 필요한 자격증명이 아직 있는지 — 여기서 사라지면 복구가 재발급이 된다.
    if grep -qE '^BASIC_AUTH_HASH=.+' .env 2>/dev/null; then
        ok ".env 에 BASIC_AUTH_HASH 보존됨 (복구는 Caddyfile 4줄 되살리기로 끝난다)"
    else
        no ".env 에 BASIC_AUTH_HASH 가 없다 — 인증 복구 시 비밀번호 재발급이 필요하다"
    fi
fi

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
# 바뀌지 않음). 401은 본문이 없어 문제가 아니지만, 그래서 검사는 반드시 '200 응답'에 대고
# 해야 한다 — 401을 검사하면 항상 실패하는 무의미한 테스트가 된다.
# 예전에는 그 200을 얻는 방법이 인증뿐이어서, 자격증명이 없으면 이 항목 전체가 skip 됐다
# (=배포마다 보안 헤더를 아무도 검증하지 않았다). 이제 /api/health 가 인증 제외이므로
# **자격증명 없이도** 검사한다. 자격증명을 주면 인증 경로까지 추가로 확인한다.
check_headers() {
    local hdrs="$1" label="$2"
    for h in "x-content-type-options" "x-frame-options" "content-security-policy" "referrer-policy"; do
        echo "$hdrs" | grep -qi "^$h:" && ok "$h 존재 ($label)" || no "$h 없음 ($label)"
    done
    echo "$hdrs" | grep -qi "^server:" \
        && no "Server 헤더가 남아 있다 ($label)" \
        || ok "Server 헤더 제거됨 ($label)"
    echo "$hdrs" | grep -qi "^strict-transport-security:" \
        && no "HSTS가 켜져 있다 — 자체서명 인증서 환경에서는 접속 불가를 유발한다" \
        || ok "HSTS 미적용 (자체서명 환경에서 의도된 설정)"
}

hdrs=$(curl -s -D - -o /dev/null -m 5 -k "https://$HOST/api/health" 2>/dev/null)
if echo "$hdrs" | grep -qiE "^HTTP.* 200"; then
    check_headers "$hdrs" "인증 없이 /api/health"
else
    no "인증 없이 /api/health 가 200이 아니다 — 헤더 검사를 할 수 없다"
fi

if [ "$AUTH_ON" = false ]; then
    # 인증이 없는 동안은 **실제 콘텐츠 응답**(`/`)에 대고도 검사할 수 있다 — 헬스보다 넓은
    # 커버리지다(정적 프론트엔드 경로의 헤더까지 본다). 인증이 돌아오면 이 경로는 401 이 되어
    # 검사할 수 없게 되므로, 그때는 아래 자격증명 분기가 다시 유일한 창구가 된다.
    hdrs=$(curl -s -D - -o /dev/null -m 5 -k "https://$HOST/" 2>/dev/null)
    if echo "$hdrs" | grep -qiE "^HTTP.* 200"; then
        check_headers "$hdrs" "인증 없이 /"
    else
        no "인증 없이 / 가 200이 아니다 — 헤더 검사를 할 수 없다"
    fi
elif [ -n "${PH_VERIFY_USER:-}" ] && [ -n "${PH_VERIFY_PASS:-}" ]; then
    hdrs=$(curl -s -D - -o /dev/null -m 5 -k -u "$PH_VERIFY_USER:$PH_VERIFY_PASS" "https://$HOST/" 2>/dev/null)
    if echo "$hdrs" | grep -qiE "^HTTP.* 200"; then
        ok "인증 성공 (200) — .env 자격증명이 정상 동작"
        check_headers "$hdrs" "인증된 /"
    else
        no "인증 실패 — .env 의 BASIC_AUTH_USER/HASH 또는 전달한 자격증명을 확인하라"
    fi
else
    skip "인증 경로 검사 건너뜀 (보안 헤더는 위에서 이미 검사했다). 함께 보려면:"
    skip "  PH_VERIFY_USER=<사용자> PH_VERIFY_PASS=<비밀번호> $0 $HOST"
fi

echo "[11] 자격증명이 VCS에 없어야 한다"
grep -qE '\$2[aby]\$' Caddyfile 2>/dev/null \
    && no "Caddyfile에 bcrypt 해시가 남아 있다" \
    || ok "Caddyfile에 해시 리터럴 없음"
git check-ignore -q .env 2>/dev/null && ok ".env 가 gitignore 처리됨" || no ".env 가 추적될 수 있다"

echo "[12] 백업 최신성"
# 이름을 출력하므로 **가장 최신 것**을 고른다 — find 의 출력 순서는 디렉토리 순서라,
# 예전에는 48시간 안에 있기만 하면 아무 파일 이름이나 보여 줬다(방금 뜬 백업이 있는데도
# 이틀 전 파일 이름을 보여 주면, 읽는 사람은 백업이 멈춘 줄로 읽는다).
latest=$(find backups -name 'ph-data-*.tar.gz' -mtime -2 -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
[ -n "$latest" ] && ok "48시간 내 백업 존재: $(basename "$latest")" || no "최근 백업 없음 — ./scripts/backup-data.sh 실행"

echo
echo "[13] 운영 지표 엔드포인트"
# 왜 배포 검증에 넣는가: 메트릭은 평소에 아무도 열어 보지 않는 경로라, 깨져도 사고가
# 터진 **뒤에야** 발견된다 — 정확히 필요할 때 없는 셈이다. 인증이 켜져 있으면 401 이
# 정답이다(헬스와 달리 예외가 아니다).
mcode=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -k "https://$HOST/api/metrics" || echo 000)
if [ "$AUTH_ON" = true ]; then
    [ "$mcode" = "401" ] && ok "GET /api/metrics → 401 (인증 뒤에 있다)" \
        || no "GET /api/metrics → $mcode (401 기대 — 지표가 인증 없이 열려 있다)"
else
    if [ "$mcode" = "200" ]; then
        body=$(curl -s -m 5 -k "https://$HOST/api/metrics")
        echo "$body" | grep -q '"uptimeSec"' && ok "GET /api/metrics → 200 (uptimeSec 포함)" \
            || no "GET /api/metrics 응답에 uptimeSec 이 없다: $(echo "$body" | head -c 120)"
        curl -s -m 5 -k "https://$HOST/api/metrics?format=prometheus" | grep -q '^ph_uptime_seconds ' \
            && ok "GET /api/metrics?format=prometheus → 노출 형식" \
            || no "prometheus 형식 응답이 아니다"
    else
        no "GET /api/metrics → $mcode (200 기대)"
    fi
fi
echo

echo "[14] TLS 인증서 이름 (SNI 없는 접속 = 브라우저로 IP 주소 접속)"
# 이 검사가 따로 있는 이유: `curl` 과 `openssl -servername` 은 SNI 를 보내므로 위 검사가
# 전부 통과하는데도 **사람은 브라우저로 들어갈 수 없는** 상태가 가능하다. 브라우저는
# IP 주소로 접속할 때 SNI 를 보내지 않고(RFC 6066), 그러면 Caddy 의 on_demand 가
# 컨테이너 IP 로 인증서를 발급해 ERR_CERT_COMMON_NAME_INVALID 가 됐다(2026-08-18 실측).
# Caddyfile 의 `default_sni` 가 그 경로를 고정한다 — 여기서 회귀를 잡는다.
if command -v openssl &>/dev/null; then
    san=$(echo | openssl s_client -connect "$HOST:443" -noservername 2>/dev/null \
        | openssl x509 -noout -ext subjectAltName 2>/dev/null | tr -d ' \n')
    if echo "$san" | grep -qF "$HOST"; then
        ok "SNI 없는 연결이 $HOST 용 인증서를 받는다"
    else
        no "SNI 없는 연결이 엉뚱한 인증서를 받는다 (${san:-응답 없음}) — 브라우저 접속이 깨진다"
    fi
else
    skip "openssl 없음 — 인증서 이름 검사 건너뜀"
fi

echo
echo "[15] 저장 엔진 (PH_STORE)"
# 왜 검사하는가: 엔진은 .env 한 줄로 바뀌고, **틀려도 서버는 정상 부팅한다.** sqlite 로
# 옮긴 뒤 그 줄이 사라지면 API 는 옆에 남아 있는 옛 JSON 파일을 조용히 서빙하기 시작하고
# (마이그레이션은 원본을 지우지 않는다 — 되돌릴 수 있어야 하므로), 그때부터 두 사본이
# 각자 갈라진다. 화면에도 로그에도 아무 신호가 없다.
want=$(sed -n 's/^PH_STORE=//p' .env 2>/dev/null | tail -1)
want=${want:-json}
got=$(d exec project-helper-api sh -c 'echo "${PH_STORE:-json}"' 2>/dev/null | tr -d '\r\n')
if [ -z "$got" ]; then
    skip "API 컨테이너가 없어 엔진을 확인하지 못했다"
elif [ "$got" = "$want" ]; then
    ok "컨테이너 엔진이 .env 와 일치한다 ($got)"
else
    no "엔진 불일치 — .env=$want, 컨테이너=$got (옛 사본을 서빙 중일 수 있다)"
fi

# 엔진이 실제로 그 저장소를 보고 있는지 — 리비전을 양쪽에서 읽어 맞춘다.
apirev=$(curl -s -m 5 -k "https://$HOST/api/revision" | sed -n 's/.*"revision":\([0-9]*\).*/\1/p')
if [ "$got" = "sqlite" ]; then
    dbrev=$(d exec project-helper-api node -e \
        'const s=require("./lib/store");process.stdout.write(String(s.getProjectStore("default").readMeta().revision))' \
        2>/dev/null | tr -d '\r\n')
    [ -n "$apirev" ] && [ "$apirev" = "$dbrev" ] \
        && ok "SQLite 리비전이 API 응답과 같다 ($apirev)" \
        || no "리비전이 어긋난다 — API=$apirev, DB=$dbrev"
elif [ "$got" = "json" ]; then
    filerev=$(d exec project-helper-api sh -c 'cat data/projects/default/meta.json 2>/dev/null' \
        | sed -n 's/.*"revision":\([0-9]*\).*/\1/p')
    [ -n "$apirev" ] && [ "$apirev" = "$filerev" ] \
        && ok "JSON 리비전이 API 응답과 같다 ($apirev)" \
        || no "리비전이 어긋난다 — API=$apirev, meta.json=$filerev"
fi

# 백업이 **현재 엔진의** 산출물을 담고 있는지 — [12] 는 최신성만 본다. 엔진을 바꾼 뒤
# 백업 스크립트가 옛 대상만 담으면, 크론은 매일 성공 로그를 남기면서 어제 데이터를
# 보관한다(JSON 원본은 지워지지 않으므로 아카이브는 '그럴듯하게' 채워져 있다).
if [ -n "${latest:-}" ]; then
    have=$(tar tzf "$latest" 2>/dev/null || true)
    if [ "$got" = "sqlite" ]; then
        case "$have" in
            *projecthelper.db.snapshot*) ok "최신 백업에 SQLite 정합 스냅샷이 있다" ;;
            *) no "최신 백업에 projecthelper.db.snapshot 이 없다 — 지금 엔진의 데이터가 백업되지 않는다" ;;
        esac
    else
        case "$have" in
            */data.json*) ok "최신 백업에 data.json 이 있다" ;;
            *) no "최신 백업에 data.json 이 없다" ;;
        esac
    fi
fi

echo "───────────────────────────────"
echo -e "통과 ${GREEN}$PASS${NC} / 실패 ${RED}$FAIL${NC}"
[ "$FAIL" -eq 0 ] || exit 1
