---
name: deploy
description: >
  ProjectHelper 배포/실행 절차. "배포해줘", "서버 띄워줘", "실행해줘",
  "docker로 올려줘", "HTTPS로 띄워줘" 요청 시 사용. Docker Compose(Caddy HTTPS),
  로컬 Node 폴백, 개발 모드(hot-reload) 각각의 절차와 주의점.
---

# ProjectHelper 배포

## 구성 요소 (docker-compose.yml — 3개 서비스)

| 서비스 | 역할 | 포트 |
|---|---|---|
| `caddy` | HTTPS 종료 + 라우팅 (유일하게 외부 노출) | 80→443 redirect, 443 |
| `project-management-app` | 정적 프론트엔드 (빌드된 dist) | 내부 80 |
| `project-helper-api` | Express API (`api_data` 볼륨 — 운영 저장 엔진은 SQLite) | 내부 3000 |

Caddy 라우팅: `/api/*` → api:3000, 나머지 → 프론트.
**2026-08-18 현재 basicauth 는 일시 제거된 상태다** (사용자 결정 — 개선 완료 후 복구).
복구 절차는 `Caddyfile` 주석에 있고, `verify-deploy.sh` 가 어느 상태인지 읽어 판정한다.
TLS는 `tls internal` (자체 서명) — 브라우저 경고는 "고급 → 계속"으로 통과.

## 배포 명령

```bash
# 프로덕션 (Docker + Caddy HTTPS) — Docker 없으면 자동으로 Node 폴백(HTTP 8080)
./start_server.sh

# 개발 모드 (소스 hot-reload, compose dev overlay)
./start_server.sh --dev

# 배포 후 검증 39건 (자격증명 없이 전부 검사한다)
./scripts/verify-deploy.sh
```

배포 **전에** 반드시 백업한다 (`start_server.sh` 가 자동으로 하고, 실패하면 배포를 중단한다):

```bash
./scripts/backup-data.sh      # 즉시 백업 (SQLite 정합 스냅샷 포함)
./scripts/restore-drill.sh    # 복원 리허설 — 임시 볼륨에 되살려 HTTP 로 확인
```

sudo docker를 사용하므로 권한 프롬프트가 뜰 수 있다.

## 로컬 개발 (Docker 없이)

```bash
npm run dev:api &   # API 서버 :3000 (없으면 앱은 localStorage 폴백으로만 동작)
npm run dev         # vite :5173 — /api는 vite proxy로 3000에 연결됨
```

## 주의점

- **데이터 위치**: 프로덕션은 `api_data` 도커 볼륨, 로컬은 `server/data/` (gitignored).
  JSON 엔진은 `projects/<pid>/{data,meta,snapshots}.json`, SQLite 엔진은 `projecthelper.db`.
  **운영은 `.env` 의 `PH_STORE=sqlite` 한 줄로 SQLite 다**(2026-08-20 전환) — 그 줄이 사라지면
  서버는 정상 부팅한 채 옆에 남아 있는 옛 JSON 사본을 서빙한다. `verify-deploy.sh` [15] 가 본다.
  감사 로그(`events.jsonl`)·세대 백업(`data.json.bak.N`)·레지스트리(`projects.json`)는 두 엔진 모두 파일이다
- **클립보드 기능은 HTTPS에서만** 동작 (이미지 캡처는 HTTP에서 다운로드로 대체)
- basicauth 비밀번호 교체는 `./scripts/rotate-password.sh` (해시를 손으로 만들지 마라 — argv 노출).
  인증이 제거된 상태에서는 그 스크립트가 거부한다(먼저 Caddyfile 복구).
- 컨테이너 재빌드가 필요한 변경: 프론트 소스(prod 모드), server/, Caddyfile
- **`docker compose down -v` 금지** — `api_data` 볼륨이 운영 데이터의 유일한 사본이다
- 배포 전 검증: `verify-app` 스킬 (`npm run verify`), 배포 후 검증: `./scripts/verify-deploy.sh`
- 컨테이너 안쪽은 `npm run verify` 가 보지 못한다 — 런타임 디렉토리를 추가하면 두 Dockerfile 의
  `COPY` 목록도 함께 고쳐야 하고, CI 의 `docker-smoke` 잡만 그것을 잡는다
