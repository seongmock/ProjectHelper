#!/bin/bash
# ProjectHelper 운영 데이터 백업
#
# 배경: 2026-08-05 기술 실사 시점에 운영 데이터의 사본이 Docker 볼륨 하나뿐이었고,
#       그 상태에서 잘못된 API 요청 한 번으로 실제 데이터가 소실됐다.
#       이 스크립트는 그 재발을 막는 최후 방어선이다.
#
# 사용법:
#   ./scripts/backup-data.sh                # 1회 백업
#   ./scripts/backup-data.sh --install-cron # 매일 03:00 자동 백업 등록
#   ./scripts/backup-data.sh --list         # 보관 중인 백업 목록
#   ./scripts/backup-data.sh --restore <아카이브>  # 복원 (확인 프롬프트 있음)
set -euo pipefail

VOLUME="projecthelper_api_data"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${PH_BACKUP_DIR:-$PROJECT_DIR/backups}"
RETAIN_DAYS=14

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[backup]${NC} $*"; }
warn() { echo -e "${YELLOW}[backup]${NC} $*"; }
die()  { echo -e "${RED}[backup] $*${NC}" >&2; exit 1; }

docker_cmd() {
    if docker info &>/dev/null; then docker "$@"; else sudo docker "$@"; fi
}

do_backup() {
    docker_cmd volume inspect "$VOLUME" &>/dev/null \
        || die "볼륨 '$VOLUME' 을(를) 찾을 수 없다. 운영 스택이 기동된 적이 있는지 확인하라."

    mkdir -p "$BACKUP_DIR"
    local stamp archive
    stamp="$(date +%Y%m%d-%H%M%S)"
    archive="$BACKUP_DIR/ph-data-$stamp.tar.gz"

    # ── 살아 있는 SQLite 를 담을 때의 정합성 ────────────────────────
    # 아래 tar 가 안전하다는 근거("파일 단위로는 항상 정합")는 **JSON 저장소에서만** 참이다
    # — writeJsonAtomic 이 tmp+rename 이므로 어느 순간에 읽어도 파일 하나는 온전하다.
    # WAL 모드의 SQLite 는 다르다: `projecthelper.db` + `-wal` + `-shm` 세 파일이 **함께**
    # 한 상태를 이루므로, 쓰기 도중 tar 하면 서로 어긋난 짝이 담길 수 있고 그 아카이브는
    # 열어 보기 전까지 정상으로 보인다. 그래서 살아 있는 DB 에 대고 VACUUM INTO 로 정합
    # 사본을 먼저 뜬다(원본은 읽기만 한다). 컨테이너가 내려가 있으면 쓰는 사람이 없으므로
    # 원본 파일 자체가 이미 정합이다 — 그때는 건너뛴다.
    ENGINE=""
    if docker_cmd ps --format '{{.Names}}' 2>/dev/null | grep -qx project-helper-api; then
        ENGINE="$(docker_cmd exec project-helper-api sh -c 'echo "${PH_STORE:-json}"' 2>/dev/null | tr -d '\r\n')"
    fi
    if [ "$ENGINE" = "sqlite" ]; then
        docker_cmd exec project-helper-api sh -c 'rm -f data/projecthelper.db.snapshot' || true
        docker_cmd exec project-helper-api node -e '
            const {DatabaseSync} = require("node:sqlite");
            const db = new DatabaseSync(process.env.PH_SQLITE_FILE || "/app/data/projecthelper.db", {readOnly: true});
            db.exec("VACUUM INTO \x27/app/data/projecthelper.db.snapshot\x27");
            db.close();
        ' 2>/dev/null || die "SQLite 정합 스냅샷(VACUUM INTO) 실패 — 백업을 신뢰할 수 없다"
        log "SQLite 정합 스냅샷 생성 (projecthelper.db.snapshot)"
    fi

    # 볼륨을 읽기 전용으로 마운트해 tar — 운영 컨테이너를 멈추지 않는다.
    docker_cmd run --rm \
        -v "$VOLUME":/data:ro \
        -v "$BACKUP_DIR":/backup \
        alpine:3.20 \
        tar czf "/backup/$(basename "$archive")" -C /data . \
        || die "백업 실패"

    # 컨테이너가 root로 만든 파일 소유권을 호출자에게 넘긴다
    if [ ! -w "$archive" ]; then
        sudo chown "$(id -u):$(id -g)" "$archive" 2>/dev/null || true
    fi

    local size
    size="$(du -h "$archive" | cut -f1)"
    log "백업 완료: $archive ($size)"

    # 무결성 검증 — 아카이브가 열리고 **지금 쓰이는 저장소**가 들어 있는지 확인한다.
    # 엔진에 따라 볼 대상이 다르다: JSON 원본은 SQLite 로 옮긴 뒤에도 (되돌릴 수 있어야
    # 하므로) 그대로 남아 있어서, data.json 만 보면 DB 가 빠진 아카이브도 통과한다 —
    # 어제 데이터를 백업해 놓고 통과 메시지를 읽는 셈이다.
    # 목록을 **변수에 한 번 담고** 셸 패턴으로 본다. `tar tzf … | grep -q` 는
    # set -o pipefail 아래에서 거짓 실패를 낸다: grep -q 가 첫 일치에서 즉시 끝나면
    # tar 가 SIGPIPE 로 죽고, 그 실패가 파이프라인의 종료 코드가 된다 — 일치가 목록
    # **앞쪽**에 있을 때만 재현되므로, 이 방식은 아카이브가 정상일 때 오히려 실패한다.
    local listing
    listing="$(tar tzf "$archive")"
    if [ "$ENGINE" = "sqlite" ]; then
        case "$listing" in
            *projecthelper.db.snapshot*) log "무결성 검증 통과 (SQLite 정합 스냅샷 포함 확인)" ;;
            *) die "무결성 검증 실패: 아카이브에 projecthelper.db.snapshot 이 없다. 백업을 신뢰하지 마라." ;;
        esac
    else
        case "$listing" in
            */data.json*) log "무결성 검증 통과 (data.json 포함 확인)" ;;
            *) die "무결성 검증 실패: 아카이브에 projects/*/data.json 이 없다. 백업을 신뢰하지 마라." ;;
        esac
    fi

    # 스냅샷은 아카이브에만 남기고 볼륨에서는 지운다 — 운영 디렉토리에 정체가 애매한
    # DB 파일이 상주하면, 다음 사람이 그것을 살아 있는 저장소로 착각한다.
    [ "$ENGINE" = "sqlite" ] && docker_cmd exec project-helper-api sh -c 'rm -f data/projecthelper.db.snapshot' || true

    # 오래된 백업 정리
    local removed
    removed="$(find "$BACKUP_DIR" -name 'ph-data-*.tar.gz' -mtime "+$RETAIN_DAYS" -print -delete | wc -l)"
    [ "$removed" -gt 0 ] && log "$RETAIN_DAYS일 초과 백업 $removed건 삭제"

    log "보관 중: $(find "$BACKUP_DIR" -name 'ph-data-*.tar.gz' | wc -l)건"
}

do_list() {
    [ -d "$BACKUP_DIR" ] || die "백업 디렉토리 없음: $BACKUP_DIR"
    log "백업 목록 ($BACKUP_DIR):"
    ls -lh "$BACKUP_DIR"/ph-data-*.tar.gz 2>/dev/null || warn "  백업 없음"
}

do_restore() {
    local archive="$1"
    [ -f "$archive" ] || die "아카이브를 찾을 수 없다: $archive"

    warn "═══════════════════════════════════════════════════"
    warn " 복원은 현재 운영 데이터를 '$archive' 내용으로 덮어쓴다."
    warn " 포함된 파일:"
    tar tzf "$archive" | head -10 | sed 's/^/   /'
    warn "═══════════════════════════════════════════════════"
    read -r -p "복원하려면 'RESTORE' 를 그대로 입력: " confirm
    [ "$confirm" = "RESTORE" ] || die "취소됨"

    # 복원 전 현재 상태를 먼저 백업 — 복원 자체가 사고가 되는 것을 막는다
    log "복원 전 현재 상태 백업 중..."
    do_backup

    docker_cmd run --rm \
        -v "$VOLUME":/data \
        -v "$(cd "$(dirname "$archive")" && pwd)":/backup:ro \
        alpine:3.20 \
        sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$archive") -C /data && \
               if [ -f /data/projecthelper.db.snapshot ]; then \
                   mv -f /data/projecthelper.db.snapshot /data/projecthelper.db && \
                   rm -f /data/projecthelper.db-wal /data/projecthelper.db-shm; \
               fi" \
        || die "복원 실패"

    # 스냅샷이 들어 있으면 그것이 정합한 사본이므로 제자리에 놓고, 짝이 맞지 않는
    # -wal/-shm 은 버린다(위 sh -c 안에서 처리). 그러지 않으면 tar 에 함께 담긴
    # '쓰기 도중의' 원본이 복원되어, 정합 사본을 뜬 의미가 사라진다.
    log "복원 완료. API 컨테이너 재시작 권장: sudo docker restart project-helper-api"
}

do_install_cron() {
    local entry="0 3 * * * $PROJECT_DIR/scripts/backup-data.sh >> $PROJECT_DIR/backups/cron.log 2>&1"
    if crontab -l 2>/dev/null | grep -Fq "backup-data.sh"; then
        warn "이미 크론에 등록되어 있다:"
        crontab -l 2>/dev/null | grep "backup-data.sh"
        return 0
    fi
    # 기존 크론 항목을 보존하며 추가
    { crontab -l 2>/dev/null || true; echo "$entry"; } | crontab -
    log "크론 등록 완료 (매일 03:00):"
    crontab -l | grep "backup-data.sh"
}

case "${1:-}" in
    --install-cron) do_install_cron ;;
    --list)         do_list ;;
    --restore)      [ $# -ge 2 ] || die "사용법: $0 --restore <아카이브>"; do_restore "$2" ;;
    "")             do_backup ;;
    *)              die "알 수 없는 옵션: $1" ;;
esac
