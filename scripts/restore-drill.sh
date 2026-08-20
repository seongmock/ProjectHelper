#!/bin/bash
# 복원 리허설 — 백업이 실제로 **앱으로 되살아나는지** 확인한다.
#
# 왜 필요한가: 여기까지 백업은 "떠졌는가"와 "아카이브가 열리는가"만 검사했다. 그 둘이
# 통과해도 복원이 되는지는 아무도 확인한 적이 없었고(`--restore` 경로는 한 번도 실행된
# 적이 없다), 복원해 본 적 없는 백업은 백업이 아니다. 특히 SQLite 로 옮긴 뒤에는 복원이
# '스냅샷 승격 + 짝 안 맞는 -wal 폐기'라는 단계를 거치므로, 그 단계가 실전에서 처음
# 돌아가는 상황을 만들면 안 된다.
#
# 운영 볼륨을 건드리지 않는다: 임시 볼륨을 새로 만들어 거기에 복원하고, 그 볼륨으로
# API 컨테이너를 띄워 **HTTP 로** 데이터를 물어본 뒤 임시 볼륨을 지운다.
#
# 사용법:
#   ./scripts/restore-drill.sh                  # 가장 최신 백업으로 연습
#   ./scripts/restore-drill.sh <아카이브>        # 특정 아카이브로
#   ./scripts/restore-drill.sh --keep            # 끝나고 임시 볼륨/컨테이너를 남긴다
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${PH_BACKUP_DIR:-$PROJECT_DIR/backups}"
IMAGE="${PH_API_IMAGE:-projecthelper_project-helper-api:latest}"
PREFIX="ph-restore-drill"   # 임시 볼륨/컨테이너 이름은 반드시 이 접두어로 시작한다

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[drill]${NC} $*"; }
warn() { echo -e "${YELLOW}[drill]${NC} $*"; }
die()  { echo -e "${RED}[drill] $*${NC}" >&2; exit 1; }

docker_cmd() {
    if docker info &>/dev/null; then docker "$@"; else sudo docker "$@"; fi
}

# shellcheck source=scripts/lib/restore-into-volume.sh
. "$PROJECT_DIR/scripts/lib/restore-into-volume.sh"

KEEP=false
ARCHIVE=""
for arg in "$@"; do
    case "$arg" in
        --keep) KEEP=true ;;
        *)      ARCHIVE="$arg" ;;
    esac
done

if [ -z "$ARCHIVE" ]; then
    ARCHIVE="$(find "$BACKUP_DIR" -name 'ph-data-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | head -1 | cut -d' ' -f2-)"
    [ -n "$ARCHIVE" ] || die "백업이 없다: $BACKUP_DIR"
fi
[ -f "$ARCHIVE" ] || die "아카이브를 찾을 수 없다: $ARCHIVE"

STAMP="$(date +%Y%m%d-%H%M%S)"
VOLUME="$PREFIX-vol-$STAMP"
CONTAINER="$PREFIX-api-$STAMP"
WORK="$(mktemp -d)"

cleanup() {
    # 접두어 검사는 형식적인 것이 아니다 — 이 스크립트가 지우는 유일한 대상이 임시
    # 자원이라는 것을 코드로 못 박아 둔다. 운영 볼륨 이름(api_data)은 절대 통과하지 못한다.
    if [ "$KEEP" = false ]; then
        case "$CONTAINER" in "$PREFIX"*) docker_cmd rm -f "$CONTAINER" &>/dev/null || true ;; esac
        case "$VOLUME" in "$PREFIX"*) docker_cmd volume rm "$VOLUME" &>/dev/null || true ;; esac
    else
        warn "임시 자원을 남겼다 — 컨테이너 $CONTAINER / 볼륨 $VOLUME"
        warn "  들여다보기: sudo docker exec -it $CONTAINER sh"
        warn "  지우기:     sudo docker rm -f $CONTAINER && sudo docker volume rm $VOLUME"
    fi
    rm -rf "$WORK"
}
trap cleanup EXIT

log "아카이브: $(basename "$ARCHIVE") ($(du -h "$ARCHIVE" | cut -f1))"

# ── 1. 기대값: 아카이브 안에 무엇이 들어 있는가 (호스트에서 직접 읽는다) ──
tar xzf "$ARCHIVE" -C "$WORK"
if [ -f "$WORK/projecthelper.db.snapshot" ]; then
    ENGINE=sqlite
elif [ -f "$WORK/projecthelper.db" ]; then
    ENGINE=sqlite
    warn "정합 스냅샷 없이 원본 DB 만 들어 있다 — 쓰기 도중 tar 된 아카이브일 수 있다"
else
    ENGINE=json
fi
log "엔진 판정: $ENGINE (아카이브 내용 기준)"

EXPECT="$(node --disable-warning=ExperimentalWarning \
    "$PROJECT_DIR/scripts/lib/restore-drill-expect.cjs" "$WORK")" \
    || die "아카이브에서 기대값을 읽지 못했다 (DB 무결성 실패 가능)"
[ "$EXPECT" != "[]" ] || die "아카이브에 프로젝트가 없다 — 이 백업으로는 복원할 것이 없다"
log "기대값: $EXPECT"

# ── 2. 임시 볼륨에 복원 (실전과 같은 함수를 지난다) ──
docker_cmd volume create "$VOLUME" >/dev/null
restore_into_volume "$VOLUME" "$(cd "$(dirname "$ARCHIVE")" && pwd)" "$(basename "$ARCHIVE")" \
    || die "복원 실패"
log "임시 볼륨에 복원 완료: $VOLUME"

# ── 3. 그 볼륨으로 API 를 띄운다 (포트를 열지 않는다 — 컨테이너 안에서 자기를 찌른다) ──
docker_cmd image inspect "$IMAGE" &>/dev/null || die "이미지가 없다: $IMAGE (./start_server.sh 를 한 번 돌려라)"
docker_cmd run -d --name "$CONTAINER" \
    -v "$VOLUME":/app/data \
    -e PH_STORE="$([ "$ENGINE" = sqlite ] && echo sqlite || echo '')" \
    -e LOG_LEVEL=warn \
    "$IMAGE" >/dev/null

for i in $(seq 1 30); do
    if docker_cmd exec "$CONTAINER" node -e '
        require("http").get({host:"127.0.0.1",port:3000,path:"/api/health"},r=>process.exit(r.statusCode===200?0:1))
            .on("error",()=>process.exit(1))' &>/dev/null; then
        break
    fi
    sleep 1
    [ "$i" = 30 ] && { docker_cmd logs "$CONTAINER" || true; die "복원한 데이터로 API 가 뜨지 않는다"; }
done
log "복원한 볼륨으로 API 부팅 성공"

# ── 4. HTTP 로 실제값을 받아 기대값과 비교 ──
# 프로브는 **표준입력으로** 넣는다. `docker cp` 로 /tmp 에 넣으면 파일은 root 소유로
# 들어가는데 컨테이너는 non-root(uid 1000)로 돌기 때문에 `EACCES` 로 읽지 못한다 —
# 운영 이미지의 성질을 우회하려고 이미지를 고치는 것보다, 파일을 아예 만들지 않는 게 맞다.
# 표준에러도 버리지 않는다 — 실패 사유를 감춘 실패 메시지는 없는 것보다 나쁘다.
if ! ACTUAL="$(docker_cmd exec -i "$CONTAINER" node - \
        < "$PROJECT_DIR/scripts/lib/restore-drill-probe.cjs" 2>"$WORK/probe.err")"; then
    die "복원한 API 에서 데이터를 읽지 못했다: $(tr '\n' ' ' < "$WORK/probe.err")"
fi
log "실제값: $ACTUAL"

if [ "$EXPECT" = "$ACTUAL" ]; then
    log "리허설 통과 — 아카이브의 프로젝트·리비전·노드 수가 복원된 앱에서 그대로 나온다"
else
    die "불일치!
  기대: $EXPECT
  실제: $ACTUAL"
fi
