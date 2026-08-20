#!/bin/bash
# 아카이브 → 도커 볼륨 복원 (backup-data.sh 의 --restore 와 restore-drill.sh 가 공유)
#
# 왜 함수로 빼는가: 복원은 **연습과 실전이 똑같아야** 의미가 있다. 두 곳에 같은 셸 한 줄을
# 복사해 두면 한쪽만 고쳐지고, 그때 어긋나는 것은 하필 "복원이 실제로 되는가"다.
#
# 호출하는 쪽이 docker_cmd 를 정의해 둬야 한다(sudo 여부는 호출자 사정이다).
#
# SQLite 정합 스냅샷(projecthelper.db.snapshot)이 들어 있으면 그것을 제자리에 놓고,
# 짝이 맞지 않는 -wal/-shm 을 버린다. 그러지 않으면 tar 에 함께 담긴 '쓰기 도중의'
# 원본이 복원되어 정합 사본을 뜬 의미가 사라진다.
restore_into_volume() {
    local volume="$1" archive_dir="$2" archive_name="$3"
    docker_cmd run --rm \
        -v "$volume":/data \
        -v "$archive_dir":/backup:ro \
        alpine:3.20 \
        sh -c "rm -rf /data/* && tar xzf /backup/$archive_name -C /data && \
               if [ -f /data/projecthelper.db.snapshot ]; then \
                   mv -f /data/projecthelper.db.snapshot /data/projecthelper.db && \
                   rm -f /data/projecthelper.db-wal /data/projecthelper.db-shm; \
               fi"
}
