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

    # 볼륨을 읽기 전용으로 마운트해 tar — 운영 컨테이너를 멈추지 않는다.
    # 쓰기 도중 스냅샷을 뜰 가능성은 있으나, writeJsonAtomic(tmp+rename) 덕분에
    # 파일 단위로는 항상 정합한 상태가 담긴다.
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

    # 무결성 검증 — 아카이브가 실제로 열리고 data.json이 들어 있는지 확인
    if tar tzf "$archive" | grep -q "projects/.*/data.json"; then
        log "무결성 검증 통과 (data.json 포함 확인)"
    else
        die "무결성 검증 실패: 아카이브에 projects/*/data.json 이 없다. 백업을 신뢰하지 마라."
    fi

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
        sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$archive") -C /data" \
        || die "복원 실패"

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
