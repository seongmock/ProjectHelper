# HANDOVER.md — AI 세션 인수인계

> **이 파일의 목적**: AI 에이전트 세션이 끊겨도 다음 세션이 컨텍스트 손실 없이 이어받게 한다.
> 작업을 시작하면 **먼저 이 파일을 읽고**, 작업을 마치면 **§4 태스크 보드와 §5 세션 로그를 갱신**한다.
>
> 역할 분담: `CLAUDE.md`=코드베이스 규약(변하지 않는 것) · **`HANDOVER.md`=진행 상태(매번 변하는 것)** ·
> `docs/TECHNICAL_DUE_DILIGENCE.md`=왜 이 작업을 하는지(근거)

---

## 1. 지금 이 프로젝트가 처한 상황 (30초 브리핑)

ProjectHelper는 React 18 + Express(JSON 파일 저장) 기반 간트차트 도구다. 운영 스택이
`10.178.21.120`에서 상시 가동 중이며 **실제 업무 일정 데이터가 들어 있다**.

2026-08-05 기술 실사 결과, 개인 도구로는 잘 만들어졌으나 **서비스로서는 배포 부적격**
판정을 받았다(데이터 안전성 F, 운영 F, 보안 D). 현재 그 실사 보고서의
**Phase 0(긴급) → Phase 1(안정화)** 개선을 순차 적용하는 중이다.

전체 진단·근거·점수는 `docs/TECHNICAL_DUE_DILIGENCE.md`를 읽어라. 요약본에 의존하지 마라.

---

## 2. 🚨 절대 규칙 (위반 시 데이터 소실)

1. **운영 API에 쓰기(write) 요청을 보내지 마라.** 읽기 전용으로만 접근한다.
   검증이 필요하면 임시 프로젝트를 만들거나 로컬 인스턴스를 띄운다.
   - 2026-08-05 실사 중 이 규칙 부재로 **실제 운영 데이터가 소실**됐다
     (`docs/TECHNICAL_DUE_DILIGENCE.md` 부록 A).
2. **`docker compose down -v` 금지.** `api_data` 볼륨에 유일한 운영 데이터 사본이 있다.
3. **배포(`./start_server.sh`) 전에 반드시 백업을 먼저 실행한다**:
   `./scripts/backup-data.sh`
4. **이 호스트의 포트 3000은 무관한 uvicorn 서비스가 점유 중이다.**
   로컬 API는 `PORT=3100 npm run dev:api`로 띄우고, Vite 프록시는
   `VITE_API_TARGET=http://localhost:3100`으로 맞춘다.
   또한 이 호스트에는 **compose v2 플러그인이 없고 `docker-compose` v1.29.2 만** 있다.
   (v1은 2023-07 EOL이지만 `condition: service_healthy` 를 정상 준수함을 실측 확인했다.
   compose v2 플러그인 이관은 후속 과제.)
5. **`docker-compose up -d --force-recreate <서비스>` 를 쓰지 마라.**
   v1.29.2 는 최신 Docker Engine에서 `KeyError: 'ContainerConfig'` 로 죽는데,
   **죽기 전에 기존 컨테이너를 해시 접두어로 rename 하고 정지시킨다**
   (2026-08-05 배포 중 실제로 서비스가 내려갔다).
   - 설정 파일(Caddyfile 등)만 바꿨을 때: `sudo docker restart caddy-https`
   - 그 외: `./start_server.sh` (전체 `up -d --build`)
   - 이미 rename 된 잔여 컨테이너가 있으면 `sudo docker rm -f <해시>_<이름>` 후 재배포
5. 트리 조작은 반드시 `src/utils/taskTree.js` 순수함수를 쓴다(제자리 변경 금지).
   시그니처를 바꾸면 CJS 대응본 `server/lib/taskTree.js`도 함께 고친다.

---

## 3. 검증 절차 (작업 후 매번)

```bash
# 1) 단위 테스트 — 도메인 순수함수 (가장 빠른 피드백)
npm run test:unit

# 2) 서버 계약 테스트
npm run test:server

# 3) 빌드
npm run build

# 4) E2E 28건 — API 서버가 반드시 떠 있어야 한다
PORT=3100 npm run dev:api &            # 별도 터미널
VITE_API_TARGET=http://localhost:3100 npx playwright test

# 5) 린트
npm run lint
```

**합격 기준**: 단위/서버 테스트 전건 통과 · 빌드 성공 · **E2E 28/28 통과(skip 0)** · 린트 0 error.

> ⚠️ E2E를 API 서버 없이 돌리면 `19 passed / 1 failed / 8 skipped`가 나온다. 이건 **불합격**이다.
> skip이 1건이라도 있으면 그 테스트는 아무것도 검증하지 않은 것이다.

배포 검증(운영 반영 후):

```bash
./scripts/verify-deploy.sh      # 헬스체크·인증경계·gzip·보안헤더 일괄 확인
```

---

## 4. 태스크 보드

상태: ✅완료 / 🔄진행중 / ⬜대기 / ⏸️보류(의사결정 필요)

### Phase 0 — 긴급 (데이터·보안) — 목표: 1일

| ID | 작업 | 상태 | 검증 방법 |
|---|---|---|---|
| P0-1 | 데이터 백업 체계(볼륨 tar + 쓰기 전 세대 보관 + 크론) | ✅ | `scripts/backup-data.sh` 실행 후 아카이브 생성 확인 |
| P0-2 | `POST /api/data` 트리 스키마 검증 | ✅ | `npm run test:server` — 비배열/오염 트리 400 |
| P0-3 | `NODE_ENV=production` + 전역 에러/404 핸들러 | ✅ | 잘못된 JSON → 스택 미노출 확인 |
| P0-4 | basicauth 자격증명 secret 분리 | ✅ | `Caddyfile`에 해시 리터럴 부재 |
| P0-5 | HTML 내보내기 XSS 차단(6개 지점) | ✅ | `npm run test:unit` — XSS 페이로드 이스케이프 |
| P0-6 | nginx gzip + Cache-Control | ✅ | `verify-deploy.sh` — Content-Encoding: gzip |

### Phase 1 — 안정화 — 목표: 1~2주

| ID | 작업 | 상태 | 검증 방법 |
|---|---|---|---|
| P1-1 | Node 22 LTS + 이미지 태그 고정 + `npm ci` + non-root | ✅ | 이미지 빌드 후 `node -v`, `whoami` |
| P1-2 | vite high 취약점 4건 해소 | ✅ | `npm audit` → 0 high |
| P1-3 | 구조화 로깅 + graceful shutdown + `PORT` env화 | ✅ | SIGTERM 시 정상 종료 로그 |
| P1-4 | 단위테스트 도입(Vitest + node:test) | ✅ | `npm run test:unit`, `npm run test:server` |
| P1-5 | ESLint + CI 게이트(lint·audit·unit) | ✅ | `npm run lint`, CI 워크플로 |
| P1-6 | E2E 가드 정리 → 28/28 green | ✅ | skip 0으로 전건 통과 |
| P1-7 | UI Quick Win | 🔶 3/6 | 스모크 테스트 + 육안 |

P1-7 세부 (실사 §5.4 Quick Win 기준):

| 항목 | 상태 |
|---|---|
| 버튼 라벨 단어 중간 줄바꿈 ("분 할") | ✅ `white-space: nowrap` |
| 태스크명 절단 → 전체 이름 툴팁 | ✅ `title={name}` |
| 지연(overdue) 색상+아이콘 이중 인코딩 | ✅ `⚠` + `aria-label` |
| 진행률 노출 | ✅ **이미 구현돼 있었음** (실사 오판 — 정정 완료) |
| 태스크명 컬럼 드래그 리사이저 | ⬜ P2-6 이관 (신규 상태·이벤트 필요) |
| 마일스톤 라벨 겹침 회피 | ⬜ P2-6 이관 (충돌 계산 로직 필요) |
| 우상단 클리핑 | ⬜ 재현 필요 — 스크린샷에서만 확인, 원인 미특정 |

### Phase 2 — 구조 (1개월, 공수 15~20일) — ⬜ 미착수

| ID | 작업 | 선행 | 비고 |
|---|---|---|---|
| P2-1 | 상태관리 도입(Zustand=UI / TanStack Query=서버) | P1-4 | `App.jsx` 1,002→400줄 목표 |
| P2-2 | `TimelineView.jsx`(1,512줄) 훅 분해 | P1-4 | `useTimelineScale`/`useBarDrag`/`useDependencyLink` |
| P2-3 | 디렉토리 재편 `features/*` + `shared/ui` | P2-1 | |
| P2-4 | 서버 Service 계층 분리 | P1-4 | Route는 HTTP만 |
| P2-5 | 공용 `Modal` 적용, 팝오버 3종 통합 | | 현재 Modal.jsx는 1곳만 사용 |
| P2-6 | UI Medium: 아이콘 Lucide 교체·툴바 3그룹 재편 | P1-7 | 시각 완성도 최대 효과 |

> **P2 착수 전 필수**: P1-4 단위테스트가 안전망이다. 테스트 없이 1,512줄을 분해하지 마라.

### Phase 3 — 제품화 (3개월) — ⬜ 미착수

| ID | 작업 | 비고 |
|---|---|---|
| P3-1 | 저장소 JSON→SQLite(better-sqlite3, WAL) | Repository 패턴 선행 필요. API 계약 무변경 |
| P3-2 | append-only 이벤트 로그(감사·undo·AI 추적 통일) | |
| P3-3 | 실제 인증/인가 + 프로젝트 RBAC + 사용자별 설정 | 현재 인가 전무 |
| P3-4 | `htmlExporter.js` 폐기 → 읽기전용 공유링크 `/share/:id` | **최대 부채 상환**: 중복 2,533줄 소멸 |
| P3-5 | 인스펙터 패널 + 정보구조 재설계 | |
| P3-6 | 관측성(메트릭·알림·업타임 감시) | |

### Phase 4 — 확장 (6개월+) — ⬜ 미착수

Postgres+pgvector · 멀티테넌시 · RAG/Copilot · Workflow 엔진 · 실시간 협업(CRDT) ·
오케스트레이션 + 무중단 배포 + IaC

### ⏸️ 사용자 의사결정 대기

| 항목 | 필요한 결정 |
|---|---|
| basicauth 비밀번호 교체 | 기존 해시가 git 이력 208커밋에 잔존. **비밀번호 실물 교체는 사용자만 가능** |
| git 이력 정리 | `git filter-repo`로 과거 해시 제거 vs 저장소 private 전환 |
| 운영 재배포 시점 | Phase 0/1 반영에는 재배포 필요. 다운타임 수용 시점 협의 |
| `restored-data.json` | 저장소 루트의 실데이터 백업 — 저장소 밖으로 이동할지 |
| 복원된 운영 데이터 | 2026-08-05 복원본이 최신인지 사용자 확인 필요 |

---

## 5. 세션 로그

### 2026-08-05 — 기술 실사 + Phase 0/1 실행

- 기술 실사 수행 → `docs/TECHNICAL_DUE_DILIGENCE.md` 작성
- **사고**: 실사 중 운영 데이터 소실. 스냅샷 `31년 SOP를 위한 양산 일정`(14 태스크)으로 복원.
  상세·재발방지는 실사 보고서 부록 A. → §2 절대규칙 1번이 여기서 나왔다
- 정리: `server.log`·`test-results/`·`.serena/cache` 삭제,
  `DEPLOY_GUIDE.md`·`project-management.service` git rm
- Phase 0 6건 + Phase 1 7건(P1-7은 3/6) 구현 완료
- 최종 검증: **lint 0 error · unit 46/46 · server 31/31 · build OK · E2E 28/28 (skip 0)**
- 단위테스트 도입 중 잠재 버그 2건 발견·수정:
  `deleteFromTree`/`addToParent`/`indentTask` 가 `children` 없는 노드에서 크래시,
  `App.jsx` 가져오기 경로가 `migrateTaskData()` 를 건너뛰어 그 상태를 실제로 만들 수 있었음
- 낡은 문서 교정: `.github/copilot-instructions.md`(전면 교체)·`AGENTS.md`·`README.md`
### 2026-08-05 (같은 날, 이어서) — 운영 재배포 완료

**배포 성공. 검증 16/16 통과 (실패 0).** 데이터 무손실 확인.

- 사전 상태 = 사후 상태: revision 5 · flat 14 태스크 · 스냅샷 4건 · 최상위 4개 동일
- 발효 확인: `NODE_ENV=production` · non-root(`node`) 실행 · Node v22.23.2 ·
  nginx gzip · immutable 캐시 헤더 · Caddyfile 해시 0 · 볼륨 소유권 1000:1000
- **압축 실효 측정: 307,297 → 95,885 bytes (3.2배 감소)** — 실사 예측과 일치
- 백업 4건 보관 중 (배포마다 자동 생성)

**배포 중 발견해 수정한 문제 2건** (둘 다 실사 보고서에 없던 것):

1. **`USER node` + 호스트 파일 모드 660 → 부팅 실패.**
   `COPY` 가 호스트 파일 모드를 보존하는데 이 저장소 파일은 공유 디렉토리 ACL 때문에
   660(그룹/타인 읽기 없음)이다. root 로 돌 때는 드러나지 않았으나 non-root 전환 즉시
   `EACCES: permission denied, open '/app/index.js'` 로 죽었다.
   → `server/Dockerfile` 에서 `chown -R node:node /app && chmod -R u+rX /app`.
2. **볼륨 소유권 마이그레이션이 `up` 이후에 있었다 (순서 결함).**
   caddy 가 api 의 healthy 를 기다리므로 api 가 못 뜨면 `up` 자체가 실패하고
   그 뒤 단계는 실행되지 않는다 — 정작 원인을 고칠 코드에 도달하지 못했다.
   → `start_server.sh` 에서 `up` **이전**으로 이동 (uid 검사 후 멱등 적용).

**검증 스크립트 자체의 오탐 2건도 수정**:
- gzip 검사가 `index.html`(751B)로 하고 있었다 — `gzip_min_length 1024` 미달이라
  압축되지 않는 것이 정상. JS 번들로 검사하도록 변경.
- 보안 헤더를 **인증 없는 401 응답**에 대고 검사했다. Caddy 는 basic_auth 의 401 을
  header 핸들러를 거치지 않고 직접 쓰므로(`route` 로 순서를 바꿔도 동일) 항상 실패했다.
  격리 테스트로 **인증된 200 응답에는 모든 헤더가 정상 적용됨**을 확인했고, 401은 본문이
  없어 문제가 아니다. → 자격증명이 주어질 때만 200 응답을 검사하도록 변경.

  ```bash
  # 보안 헤더까지 검사하려면 (비밀번호를 알 때)
  PH_VERIFY_USER=<사용자> PH_VERIFY_PASS=<비밀번호> ./scripts/verify-deploy.sh
  ```

---

## 6. 새 세션 시작 체크리스트

```bash
# 1) 컨텍스트 로드
cat HANDOVER.md                      # 이 파일 — 현재 상태
cat CLAUDE.md                        # 코드베이스 규약
# docs/TECHNICAL_DUE_DILIGENCE.md    # 왜 이 작업을 하는지

# 2) 현재 건강 상태
git status && git log --oneline -5
npm run test:unit && npm run test:server && npm run build

# 3) 운영 상태 (읽기 전용!)
sudo docker ps
curl -s -o /dev/null -w "%{http_code}\n" -k https://10.178.21.120/api/health   # 401 정상(인증 필요)

# 4) 백업 최신성
ls -la backups/ 2>/dev/null | tail -3
```

작업을 마치면 §4 태스크 보드 상태와 §5 세션 로그를 **반드시** 갱신하고 끝낸다.
