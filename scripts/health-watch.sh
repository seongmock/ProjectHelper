#!/bin/bash
# ProjectHelper 가동 감시 — 크론으로 돌리는 한 파일짜리 업타임 체크.
#
# 배경(P3-6): 관측성에서 실제로 아쉬웠던 것은 대시보드가 아니라 **사람이 먼저 알아채는
# 것**이었다. 사이트가 내려가면 누군가 "안 열리는데요"라고 말할 때까지 아무도 모른다.
# 그렇다고 컨테이너 하나짜리 사내 도구에 Prometheus + Alertmanager 를 얹으면 돌봐야 할
# 대상이 하나에서 넷으로 늘어난다. 그래서 이 스크립트는 스택이 아니라 크론 한 줄이다.
#
# 판정 규칙 두 가지가 핵심이다:
#   · **연속 실패**로만 알린다. 배포 중 재시작 한 번에 알림이 오면 그 알림은 곧 무시된다.
#   · 복구도 알린다. "언제 죽었나"만 알고 "언제 살아났나"를 모르면 확인하러 가야 한다.
#
# 사용법:
#   ./scripts/health-watch.sh                 # 1회 점검 (크론이 부르는 형태)
#   ./scripts/health-watch.sh --install-cron  # 5분마다 등록
#   ./scripts/health-watch.sh --status        # 최근 상태와 로그 꼬리
#
# 환경변수:
#   PH_HEALTH_URL   점검 대상 (기본 https://localhost/api/health — 자체서명이라 -k 로 붙는다)
#   PH_FAIL_STREAK  알림을 내기까지의 연속 실패 횟수 (기본 3 → 5분 주기면 약 15분)
#   PH_ALERT_CMD    알림 명령. 상태(down|up)와 메시지를 인자로 받는다.
#                   예: PH_ALERT_CMD='curl -s -X POST -d "text=$2" https://hooks.example/…'
#                   비워 두면 로그에만 남는다 — 그래도 사후 추적은 된다.
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${PH_HEALTH_URL:-https://localhost/api/health}"
STATE_DIR="${PH_STATE_DIR:-$PROJECT_DIR/.health}"
STATE_FILE="$STATE_DIR/streak"
LOG_FILE="$STATE_DIR/health.log"
FAIL_STREAK="${PH_FAIL_STREAK:-3}"
TIMEOUT=10

mkdir -p "$STATE_DIR"

log() { echo "$(date -Iseconds) $*" >> "$LOG_FILE"; }

alert() { # $1=down|up  $2=메시지
    log "ALERT[$1] $2"
    echo "[health-watch] $2" >&2
    if [ -n "${PH_ALERT_CMD:-}" ]; then
        bash -c "$PH_ALERT_CMD" -- "$1" "$2" || log "알림 명령 실패(무시): $PH_ALERT_CMD"
    fi
}

case "${1:-}" in
    --install-cron)
        line="*/5 * * * * $PROJECT_DIR/scripts/health-watch.sh >/dev/null 2>&1"
        if crontab -l 2>/dev/null | grep -Fq "health-watch.sh"; then
            echo "이미 등록되어 있다:"; crontab -l | grep "health-watch.sh"; exit 0
        fi
        (crontab -l 2>/dev/null; echo "$line") | crontab -
        echo "등록했다 (5분 주기): $line"
        exit 0
        ;;
    --status)
        echo "대상   : $URL"
        echo "연속실패: $(cat "$STATE_FILE" 2>/dev/null || echo 0) (임계 $FAIL_STREAK)"
        echo "--- 최근 로그 ---"
        tail -20 "$LOG_FILE" 2>/dev/null || echo "(아직 기록 없음)"
        exit 0
        ;;
esac

# -k: 배포는 자체서명(tls internal)이다. 이름·체인 검증은 verify-deploy.sh 의 몫이고,
# 여기서 보는 것은 "응답하는가" 하나다.
body="$(curl -fsSk --max-time "$TIMEOUT" "$URL" 2>/dev/null)"
rc=$?
prev="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"

if [ $rc -eq 0 ] && echo "$body" | grep -q '"ok":true'; then
    echo 0 > "$STATE_FILE"
    if [ "$prev" -ge "$FAIL_STREAK" ]; then
        alert up "복구됐다 — $URL (연속 실패 ${prev}회 뒤)"
    else
        log "ok"
    fi
    exit 0
fi

streak=$((prev + 1))
echo "$streak" > "$STATE_FILE"
log "fail(curl=$rc) streak=$streak body=${body:0:120}"

# 임계값을 **넘는 순간 한 번만** 알린다. 매 주기마다 보내면 알림이 소음이 되고,
# 소음이 된 알림은 꺼진다.
if [ "$streak" -eq "$FAIL_STREAK" ]; then
    alert down "응답 없음 — $URL (연속 ${streak}회, curl=$rc)"
fi
exit 1
