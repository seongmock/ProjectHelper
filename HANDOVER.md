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
판정을 받았다(데이터 안전성 F, 운영 F, 보안 D). 그 보고서의 로드맵을 순차 적용해
**Phase 0·1·2 는 전건 완료**했고(2026-08-06), Phase 3 은 항목별로 재평가해 부채성 1건
(감사 로그)만 실행하고 나머지는 판단 근거와 함께 §4에 남겼다. Phase 4 는 착수하지 않는다.

지금 이 저장소는 "실사 지적사항을 갚는" 단계에서 **"제품 방향을 정해야 하는"** 단계로
넘어와 있다. 남은 큰 항목들(인증/RBAC, 공유링크, 인스펙터 패널)은 기술 부채가 아니라
사용자가 용도를 정해야 하는 제품 결정이다.

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

# 4) E2E 36건 — playwright.config.js 가 API·dev 서버를 자동 기동한다
npx playwright test

# 5) 린트
npm run lint
```

**합격 기준**: lint 0 error · unit 167/167 · server 97/97 · 빌드 성공 · **E2E 36/36(skip 0)**.

> ⚠️ 예전에는 API 서버를 수동으로 띄우지 않으면 `19 passed / 1 failed / 8 skipped`가 났다.
> 지금은 config 가 자동 기동하지만 원칙은 그대로다 — skip이 1건이라도 있으면 그 테스트는
> 아무것도 검증하지 않은 것이고, **불합격**이다.

> ⚠️ **E2E 가 갑자기 `1 failed / 8 skipped` 로 돌아가면 코드가 아니라 떠 있는 서버를 의심하라.**
> `playwright.config.js` 는 `reuseExistingServer: !CI` 라서, 손으로 띄워 둔 dev 서버가
> 3101/5173 을 잡고 있으면 그것을 **그대로 재사용**한다. 그 Vite 가 다른
> `VITE_API_TARGET`(예: 죽은 3100)을 보고 있으면 모든 API 호출이 500 이 되고 조건부
> skip 이 켜진다. 2026-08-06 에 실제로 이 함정에 걸렸다(육안 검증용 서버가 남아 있었다).
> `pkill` 은 이 셸에서 종료코드 144 를 내며 실패할 수 있으므로 **결과를 믿지 말고 확인**한다:
> `lsof -i :3101 -sTCP:LISTEN` / `lsof -i :5173 -sTCP:LISTEN` → 남아 있으면 PID 로 `kill`.

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
| P1-7 | UI Quick Win | ✅ 6/6 | 스모크 테스트 + 육안 |

P1-7 세부 (실사 §5.4 Quick Win 기준):

| 항목 | 상태 |
|---|---|
| 버튼 라벨 단어 중간 줄바꿈 ("분 할") | ✅ `white-space: nowrap` |
| 태스크명 절단 → 전체 이름 툴팁 | ✅ `title={name}` |
| 지연(overdue) 색상+아이콘 이중 인코딩 | ✅ `⚠` + `aria-label` |
| 진행률 노출 | ✅ **이미 구현돼 있었음** (실사 오판 — 정정 완료) |
| 태스크명 컬럼 드래그 리사이저 | ✅ 기능은 있었으나 4px·투명이라 보이지 않았다 — hover 노출 + 히트영역 확대 |
| 마일스톤 라벨 겹침 회피 | ✅ **이미 구현돼 있었음** (`TimelineBar.jsx` top→bottom→right 충돌 회피) |
| 우상단 클리핑 | ✅ 원인 규명 — 툴바가 한 줄 flex 인데 스크롤이 없었다. `.toolbar-content { overflow-x: auto }` + E2E 회귀 |

### Phase 2 — 구조 — ✅ 완료 (2026-08-06)

| ID | 작업 | 상태 | 결과 |
|---|---|---|---|
| P2-1 | 상태관리 도입 | ✅ | Zustand `settingsStore`/`uiStore` + `useTaskActions`/`useProjectSync`/`useImportExport` 추출 |
| P2-2 | `TimelineView.jsx`(1,512줄) 훅 분해 | ✅ | `useTimelineScale`/`useBarDrag`/`useDependencyLink`/`useTimelineCapture`/`useSidebarResize` |
| P2-3 | 디렉토리 재편 | ✅ | `features/{shell,table,timeline,tasks,projects,io}` + `shared/{ui,hooks}`. `components/`·`hooks/` 소멸 |
| P2-4 | 서버 Service 계층 분리 | ✅ | `services/{task,data,project}Service` + `lib/httpAdapter` — 라우트는 HTTP만 |
| P2-5 | 공용 `Modal` 적용, 팝오버 통합 | ✅ | 모달 껍데기 4벌 → 1벌, `usePopover` 추출. Escape 동작 불일치·미정의 `.close-button` 도 함께 해소 |
| P2-6 | UI Medium: Lucide 아이콘·툴바 3그룹 | ✅ | `DisplayOptionsMenu` 로 토글 6종+테마 흡수. 마일스톤 도형 글리프와 가이드 본문 이모지는 데이터/콘텐츠이므로 유지 |

> TanStack Query 는 도입하지 않았다. 서버 상태 접근이 `storage.js` 한 곳으로 이미 모여 있고
> 리비전 기반 동기화가 그 역할을 하고 있어, 라이브러리를 얹으면 계층만 하나 늘어난다.

### Phase 3 — 제품화 — 🔶 1/6 실행, 5건은 의사결정 대기

2026-08-06 에 항목별로 재평가했다. **부채 상환**인 것만 실행하고, **제품 방향 결정**이
필요한 것은 근거와 함께 여기 남긴다. 실사 보고서가 "부채"로 분류한 것 중 일부는 실제로는
새 제품 기능이었고, 하나(P3-1의 선행 조건)는 이미 충족돼 있었다.

| ID | 작업 | 상태 | 판단 |
|---|---|---|---|
| P3-1 | 저장소 JSON→SQLite | ⏸️ | **선행 조건은 이미 충족됐다.** `getProjectStore(pid)` 가 반환하는 `{readTasks, writeTasks, withTasks, readMeta, readSnapshots, writeSnapshots, readEvents}` 가 곧 Repository 인터페이스고, 서비스 계층은 fs 를 모른다(P2-4). SQLite 전환은 같은 인터페이스를 구현한 모듈 교체 + 마이그레이션 스크립트로 끝난다. 다만 **지금 할 이유가 없다**: 데이터 규모가 수십 노드×소수 프로젝트고, 원자적 쓰기·세대 백업·리비전이 이미 있다. 반면 `better-sqlite3` 는 네이티브 빌드라 Docker 이미지와 재현가능 빌드에 부담이 생기고, 운영 데이터 마이그레이션 리스크가 있다. **트리거**: 동시 편집자가 여럿이 되거나 프로젝트가 수백 개가 될 때 |
| P3-2 | append-only 이벤트 로그 | ✅ | `lib/eventLog.js` + `GET /api/projects/:pid/events`. 단, **감사·추적까지만** 구현했다. "undo 통일"(이벤트 소싱으로 상태 복원)은 하지 않았다 — 클라이언트 undo 는 이미 `useUndoRedo` 가, 서버 복구는 세대 백업·스냅샷이 담당하고 있어 세 번째 메커니즘을 얹으면 복구 경로만 늘어난다 |
| P3-3 | 실제 인증/인가 + RBAC | ⏸️ | **제품 결정 필요.** 사용자 저장소·로그인 UI·세션이 새로 필요하고, 현재는 Caddy basicauth 단일 계정 뒤의 사내 단일 사용자 도구다. 누구와 공유할지가 정해지기 전에는 만들 대상(역할·권한 경계)이 정의되지 않는다. 지금 있는 것: `X-Auth-User` 를 owner/createdBy 와 감사 로그에 기록(강제는 없음) |
| P3-4 | `htmlExporter.js` 폐기 → `/share/:id` | ⏸️ | **반대 근거가 있다.** 실사는 "중복 2,533줄 소멸"만 봤지만, 내보낸 HTML 은 **사내 위키에 임베드**된다(`.github/copilot-instructions.md`). 공유링크로 바꾸면 서버 가동·basicauth 통과가 전제가 되어 위키 임베드가 깨지고, 자기완결 산출물이라는 성질(오프라인·첨부 전달)을 잃는다. 중복 자체는 실재하므로 **대안**: 폐기가 아니라 렌더 로직을 공용 모듈로 뽑아 양쪽이 공유. 사용자 결정 필요 |
| P3-5 | 인스펙터 패널 + 정보구조 재설계 | 🔶 | v1(요약·편집) + **v2(작업 설정 팝오버 흡수·폐기) 완료**(2026-08-07, 아래 UX 표 참조). 남은 것은 ① `MilestoneEditPopover` 흡수(v3) ② 정보구조 재설계(§5.4-11, 별도 항목) |
| P3-6 | 관측성(메트릭·알림·업타임) | ⏸️ | 이미 있는 것: 구조화 요청 로그(감사 필드 포함), `/api/health`, 배포 헬스게이트, `verify-deploy.sh`. 단일 컨테이너 사내 도구에 Prometheus/알림 스택을 얹는 것은 과설계다. **트리거**: 사용자가 늘어 다운타임을 사람이 먼저 알아채는 상황이 반복될 때 |

### UX 고도화 — 자동 스케줄 사이클 (Phase 번호 없음)

Phase 2/3 이후로는 실사 §5.4 의 남은 개선안을 자동 스케줄이 한 세션에 한 건씩 소화한다.

| 항목 | 상태 | 결과 |
|---|---|---|
| 실사 §5.4-10 색상 범례 + 상태 기반 색상 모드 | ✅ 2026-08-06 | `getTaskStatus()`(완료/지연/진행중/예정/none) + `STATUS_STYLES` + `TimelineLegend`. 표시 옵션에 "바 색상" 라디오. 내보낸 HTML 도 같은 색·범례를 굽는다 |
| 실사 §5.4-11 정보구조 재설계(좌측 레일) | ⬜ | 프로젝트가 늘어야 필요해진다. 트리거 대기 |
| 실사 §5.4-12 인스펙터 패널 (= P3-5) | 🔶 2026-08-07 | **v1 완료** — `features/tasks/InspectorPanel.jsx` + 파생 계산 순수함수 `summarizeTask()`. 툴바 우측 상시 버튼으로 토글(`showInspector` 설정에 저장) |
| 실사 §5.4-12 인스펙터 v2 — 작업 설정 팝오버 흡수 | ✅ 2026-08-07 | `TimelineBarPopover`(520줄) **삭제**. 기간 편집·의존성 추가/제거·구분선·마일스톤 추가·작업 삭제가 모두 패널로 들어왔다. 우클릭 = 선택 + 인스펙터 열기 + 그 기간 강조 |
| 실사 §5.4-12 인스펙터 v3 — 마일스톤 편집 팝오버 흡수 | ⬜ | `MilestoneEditPopover`(228줄)가 남아 있다. 타임라인의 마일스톤 마커 클릭이 진입점이고, 편집 대상이 작업이 아니라 마일스톤이라 **인스펙터의 선택 모델(작업 1개)을 먼저 정해야 한다** — 마일스톤을 선택 대상으로 승격할지, 마일스톤 목록 항목을 인라인 편집으로 열지 |
| 실사 §5.4-13 키보드 편집 | ✅ 2026-08-06 | `useTaskKeyboard` — ↑↓ 선택 이동, `[`/`]` 일정 이동(Shift 주 단위, Alt 종료일만). 규칙은 `shiftTaskDates()` 순수함수 |
| 실사 §5.4-13 명령 팔레트(Ctrl+K) | ⬜ | 위와 한 항목이었지만 성격이 다르다 — 접근성 구멍은 메워졌고, 팔레트는 명령 검색 UI 신설이다 |

> 상태 색상 모드에서 **표(TableView)는 손대지 않았다.** 표는 이미 지연을 아이콘+색 이중으로
> 인코딩하고 있고(P1-7), 색상 칩은 사용자가 작업 색을 고르는 입력이다. 색상 모드를 표에까지
> 밀면 그 입력의 의미가 모드에 따라 흔들린다.

> 키보드 단축키는 **모달·팝오버가 열려 있으면 동작하지 않는다**(`.modal-overlay`,
> `.milestone-popover` 존재 여부로 판단). 새 오버레이를 만들면 그 클래스를 쓰거나
> `useTaskKeyboard.js` 의 `hasOverlay()` 에 추가해야 한다 — 가려진 작업이 조용히
> 움직이는 것이 이 훅의 가장 위험한 오작동이다.
> (v2 전에는 목록이 `.timeline-popover` 였고 `.milestone-popover` 는 빠져 있었다 —
> 마일스톤 편집 팝오버 뒤에서 작업이 움직이고 있었다. v2 에서 함께 고쳤다.)

### Phase 4 — 확장 (6개월+) — ⬜ 착수하지 않음(의도적)

Postgres+pgvector · 멀티테넌시 · RAG/Copilot · Workflow 엔진 · 실시간 협업(CRDT) ·
오케스트레이션 + 무중단 배포 + IaC

이 목록은 기술 부채 상환이 아니라 **신규 제품 기능**이다. 특히 단일 사용자 사내 간트
도구에 CRDT 실시간 협업을 넣는 것은 규모에 맞지 않는다(P3-3 인증조차 아직 필요가 정의되지
않았다). 사용자가 방향을 정하기 전까지 착수하지 않는다.

### ⏸️ 사용자 의사결정 대기

| 항목 | 필요한 결정 |
|---|---|
| basicauth 비밀번호 교체 | 기존 해시가 git 이력 208커밋에 잔존. **비밀번호 실물 교체는 사용자만 가능** — 도구는 준비돼 있다: `./scripts/rotate-password.sh`(입력 비노출·`.env` 백업·실패 시 자동 롤백). 실행하면 Caddy 컨테이너가 재생성된다 |
| git 이력 정리 | `git filter-repo`로 과거 해시 제거 vs 저장소 private 전환 |
| 운영 재배포 시점 | Phase 0/1 반영에는 재배포 필요. 다운타임 수용 시점 협의 |
| `restored-data.json` | 저장소 루트의 실데이터 백업 — 저장소 밖으로 이동할지 |
| 복원된 운영 데이터 | 2026-08-05 복원본이 최신인지 사용자 확인 필요 |
| 푸시 전략 | main 직푸시 vs 브랜치+PR. 저장소 이력은 main 직푸시였고 `npm run verify` 가 게이트다 |
| 무인 실행 권한 레일 | `.claude/settings.local.json` 을 **사용자가 직접** 편집해야 한다 — 자동 스케줄이 `git push` 에서 권한 분류기에 막힌다 |
| P3-4 `htmlExporter` | 폐기(공유링크 전환) vs 유지+렌더 로직 공유 모듈화. 위키 임베드 용례가 걸려 있다 |
| P3-3 인증/RBAC | 이 도구를 누구와 공유할 것인지 정해져야 만들 대상이 생긴다 |

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

### 2026-08-06 — Phase 2 전건 완료 + Phase 3 재평가

**Phase 2 6건 모두 완료.** 커밋 순서: P2-4 → P2-1 → P2-2 → P1-7 잔여 → P2-5 → P2-6 → P2-3.

- 규모: `App.jsx` 1,002 → 약 400줄, `TimelineView.jsx` 1,512 → 훅 5개 + 순수 모듈 2개로 분해,
  서버 라우트는 HTTP 어댑터만 남고 도메인 로직은 `services/` 로.
- 테스트가 46/31/28 → **112/97/31** 로 늘었다. 리팩토링 중 안전망 역할을 실제로 했다.
- 리팩토링 중 드러난 잠재 결함 2건: 미정의 CSS 클래스(`.close-button` — 어디에도 정의가
  없었다), 모달마다 Escape 동작이 달랐던 것. 둘 다 껍데기를 하나로 합치면서 해소.
- 툴바 드롭다운은 `overflow-x: auto`(P1-7 클리핑 수정) 에 잘려서 **body 로 포털**한다.
  같은 툴바 안에 팝업을 새로 넣을 때 반복될 함정이다.

**Phase 3 은 항목별로 재평가했다** (§4 Phase 3 표에 근거 기재). 실행: P3-2 감사 로그 1건.
나머지 5건은 제품 결정 대기이거나(P3-3/P3-4), 지금 할 이유가 없거나(P3-1/P3-6),
신규 기능(P3-5)이다. 특히 **P3-4(htmlExporter 폐기)는 반대 근거가 있다** — 내보낸 HTML 이
사내 위키에 임베드되므로 공유링크로 대체하면 그 용례가 깨진다. Phase 4 는 착수하지 않았다.

**남은 사람 손 필요**:
1. `.claude/settings.local.json` 권한 레일 — 자동 스케줄이 무인 실행될 때
   `git push origin main` 에서 권한 분류기에 걸린다. 사용자가 직접 편집해야 한다.
2. main 직푸시 vs 브랜치+PR 결정 (로컬 커밋이 origin/main 보다 앞서 있다).
   → **2026-08-06 결정: 당분간 푸시하지 않는다.** 로컬 커밋만 쌓고 푸시 시점은 사용자가
   직접 정한다. 자동 스케줄 프롬프트에도 `git push` 금지가 절대 규칙으로 들어갔으므로
   1번 권한 레일 문제도 함께 무의미해졌다.

### 2026-08-06 — 상태 색상 모드 + 타임라인 범례 (실사 §5.4-10)

Phase 2/3 이후 첫 UX 사이클. 실사에서 지적된 "색상이 그룹 구분일 뿐 상태·건강도 의미가
없어 색을 해석할 방법이 없음"을 해소했다.

- 판정 규칙은 **한 곳**에만 둔다: `taskTree.js` 의 `getTaskStatus()`
  (완료 > 지연 > 예정 > 진행중, 날짜 없으면 `'none'`). 색·라벨도 한 곳 — `themes/index.js`
  의 `STATUS_STYLES`.
- 표시 옵션에 "바 색상" 라디오(작업 색상 / 상태 색상)를 추가했고, 상태 모드일 때만
  `TimelineLegend` 가 뜬다. **범례는 `captureRef` 바깥**이다 — PNG 캡처가 높이를 행 수로
  계산하므로 안에 넣으면 계산이 어긋난다.
- 색맹 대비로 스와치에 패턴(테두리/투명도/사선)을 함께 실었다. 색만으로 구분하지 않는다.
- 내보낸 HTML 도 같은 색과 범례를 갖는다. 단 규칙을 문서 안에 재구현하지 않고
  **내보내는 시점에 작업별 색을 구워 넣는다**(`buildStatusColorMap`) — 이미 2,533줄짜리
  렌더 중복이 있는 파일에 판정 로직까지 복제할 이유가 없다.
- **표(TableView)는 손대지 않았다.** 표의 색 칩은 작업 색을 *입력*받는 UI라 상태색으로
  덮으면 편집 대상과 표시가 어긋난다. 지연은 표에서 이미 별도 표기가 있다.
- 검증: lint 0 error · unit **123/123** · server **97/97** · 빌드 OK · E2E **32/32 (skip 0)**.
  격리 인스턴스(`PORT=3100 PH_DATA_DIR=.tmp-visual-data`)로 브라우저 육안 확인까지 마쳤다.

### 2026-08-06 — 키보드 일정 편집 (실사 §5.4-13 전반부)

실사 §5.3 의 "타임라인 바는 마우스 드래그 전용 → **키보드로 일정 변경 불가**"를 메웠다.

- `useTaskKeyboard` (features/tasks): ↑↓ 선택 이동, `[`/`]` 하루 이동, `{`/`}` 일주일,
  `Alt+[`/`Alt+]` 종료일만 조정. 선택이 없을 때 ↓ 가 첫 작업을 잡으므로 마우스 없이 진입된다.
- 날짜 계산은 순수함수 `shiftTaskDates(task, days, mode)` 하나로 모았다. 바뀔 것이 없으면
  **null 을 반환**해서 날짜 없는 작업에 undo 히스토리만 쌓이는 일을 막는다. UTC 로 파싱·가산
  한다 — `setDate`(로컬) + `toISOString`(UTC) 를 섞으면 음수 오프셋 지역에서 하루가 밀린다.
- 입력 중(`input/textarea/select/contenteditable`)과 오버레이가 떠 있을 때는 가로채지 않는다.
- 명령 팔레트(Ctrl+K)는 하지 않았다 — 접근성 구멍은 이것으로 닫혔고, 팔레트는 성격이 다른
  신규 UI 다. §4 UX 표에 별도 항목으로 분리해 뒀다.
- 검증: lint 0 error · unit **131/131** · server **97/97** · 빌드 OK · E2E **34/34 (skip 0)**.
  검증 도중 §3 에 적어 둔 "떠 있는 서버 재사용" 함정에 걸렸다 — 실패 원인은 코드가 아니었다.

### 2026-08-07 — 인스펙터 패널 v1 (실사 §5.4-12 / P3-5)

실사 §5.4-12 "우측 인스펙터 패널 도입 — 팝오버 기반 편집은 화면이 좁아질수록 실패한다".
팝오버는 (1) 존재를 알아야 열 수 있고 (2) 좁은 화면에서 잘리고 (3) 선택과 무관하게 떠서
"지금 무엇을 보고 있는지"를 말해 주지 못했다. 그 세 가지를 패널 하나로 메웠다.

- **파생 계산은 전부 순수함수 한 곳**: `taskTree.js` 의 `summarizeTask(tasks, id, todayStr)`
  — 상태·전체 기간·소요 일수·남은(지난) 일수·기간/마일스톤 정렬·자손 진행률 롤업·앞뒤
  의존성을 한 번에 돌려준다. 컴포넌트는 그리기만 한다. 단위테스트 19건이 붙어 있다.
  - 함께 추가: `flattenAll`(접힌 가지까지 내려간다 — `flattenTasks` 는 expanded 만 본다),
    `collectEntities`(작업+마일스톤+기간을 한 배열로). 후자는 App.jsx 팝오버 블록에
    같은 코드가 인라인으로 있던 것을 뽑아낸 것이라 양쪽이 이제 한 정의를 쓴다.
  - **의존성은 작업 ID 만 보면 절반을 놓친다** — 기간·마일스톤 단위로도 걸린다.
    그래서 소유 ID 집합(작업+기간+마일스톤) 기준으로 앞뒤를 찾는다.
- **텍스트 편집은 blur/Enter 에 커밋**한다(`DraftField`). 글자마다 커밋하면 undo 히스토리
  20칸이 타이핑만으로 차서 직전 작업을 되돌릴 수 없게 된다. 기존 팝오버의 설명 textarea 가
  실제로 그 상태다(이번엔 손대지 않았다). 진행률 슬라이더는 팝오버와 동일하게 즉시 커밋.
- 토글은 **표시 옵션 메뉴 안이 아니라 툴바 우측 상시 버튼**이다. 선택한 작업을 어디서 보는지가
  메뉴에 숨으면 패널의 존재를 알 방법이 없다. 상태는 `showInspector` 설정에 저장된다
  (= 전역 설정이라 E2E 에서 켠 뒤 반드시 되돌린다).
- 패널은 `.main-content` 의 flex 자식이라 `overflow:auto` 를 그대로 물려받는다.
  1000px 폭 분할 뷰에서 표 컬럼이 좁아지는 것은 **인스펙터 도입 전과 동일**함을
  스크린샷 대조로 확인했다(회귀 아님).
- **팝오버 3종은 제거하지 않았다.** 기간별 라벨·색, 의존성 연결 시작이 아직 거기에만 있다.
  그 흡수와 폐기가 v2 이고, 한 세션에 끝날 크기가 아니라 쪼갰다.
- 검증: lint 0 error · unit **150/150** · server **97/97** · 빌드 OK · E2E **35/35 (skip 0)**.
  격리 인스턴스(`PORT=3100 PH_DATA_DIR=.tmp-visual-data`)로 타임라인·분할·좁은 화면 육안 확인.

곁들여: 이전 세션이 커밋하지 않고 남긴 `scripts/rotate-password.sh` 를 검토 후 커밋했다.
비밀번호 실물 교체는 여전히 사용자만 할 수 있다(§4 의사결정 대기 표).

### 2026-08-07 (같은 날, 이어서) — 인스펙터 v2: 작업 설정 팝오버 흡수·폐기 (P3-5)

v1 이 남겨 둔 "팝오버 3종 흡수"의 첫 덩어리. **`TimelineBarPopover.jsx`(520줄) +
`.css`(85줄) 를 삭제**하고 그 기능 전부를 인스펙터로 옮겼다. 편집 표면이 둘이면
"지금 무엇을 고치고 있는지"가 흔들리고, 같은 기능이 두 곳에 복제된다.

- **우클릭의 의미가 바뀌었다**: 팝오버를 띄우는 대신 그 작업을 선택하고 인스펙터를
  연다(`showInspector` 를 켠다). 특정 기간 바를 우클릭했으면 `selectedRangeId` 로
  그 기간을 강조하고, "연결 추가"의 주체도 그 기간이 된다.
  - `selectedRangeId` 는 선택이 바뀌어도 남을 수 있어서 **인스펙터가 소유 여부를
    확인하고 무시한다**(`summary.ranges.some(...)`). 스토어에서 지우려면 선택을 바꾸는
    경로를 전부 알아야 하는데 그게 4곳이다.
- **기간 수정은 순수함수 3개를 거친다**: `patchRange`/`appendRange`/`removeRange`
  (taskTree.js). 반환은 `updateTask` 에 넘길 patch 이고 **항상 bounds 를 함께 재계산**한다
  — 폐기한 팝오버는 라벨·색 변경 경로에서 재계산을 건너뛰고 있었다(표가 읽는 레거시
  `startDate/endDate` 와 갈라진다). 대상이 없으면 null → 빈 undo 항목을 만들지 않는다.
  - `appendRange` 는 `timeRanges` 가 비었는데 레거시 날짜가 남아 있으면 먼저 승격한다.
    승격하지 않으면 bounds 재계산이 새 기간만 보고 레거시 날짜가 조용히 사라진다.
- **의존성 제거도 순수함수**: `planDependencyRemoval(flatList, holderId, dependencyId)`
  → `{taskId, updates}`. 보유자가 작업/기간/마일스톤 중 무엇이냐에 따라 갱신 필드가
  달라지는 분기를 App.jsx 인라인에서 여기로 옮겼다. 그리고 `summarizeTask` 가 앞뒤 목록에
  **제거에 필요한 상대 정보를 함께 싣는다** — 선행엔 `holderId`(내 쪽 보유자), 후행엔
  `depId`(상대가 참조하는 내 쪽 id). 이게 없으면 화면이 다시 트리를 뒤져야 한다.
- **300px 폭에 맞춰 접었다**: 기간 카드는 라벨 + 날짜만 펼치고 색 팔레트(9칸 한 줄)와
  레이블 위치·바 높이는 `<details>` 안이다. 전부 펼치면 기간 3개로 패널을 넘긴다.
- **표 뷰에서는 "연결 추가"가 잠긴다**(`canLink={viewMode !== 'table'}`). 연결은
  TimelineView 의 명령형 핸들이 필요한데 표 뷰에는 그 ref 가 없다. 팝오버 시절에는
  같은 상황에서 버튼이 조용히 아무것도 하지 않았다.
- 곁들여 고친 것: `hasOverlay()` 가 `.milestone-popover` 를 보지 않아 **마일스톤 편집
  팝오버 뒤에서 ↑↓·`[ ]` 가 작업을 움직이고 있었다**. `.timeline-popover` 를 지우면서
  함께 교체했다.
- 검증: lint 0 error · unit **167/167** · server **97/97** · 빌드 OK · E2E **36/36 (skip 0)**.
  E2E 는 우클릭 경로 2건을 인스펙터 기준으로 고쳐 쓰고 1건을 추가했다(기간 강조·기간
  날짜 편집·기간 추가·undo). `showInspector` 는 전역 설정이라 각 테스트가 끝에서 되돌린다.
  패널 스크린샷으로 1400px/1000px 분할 레이아웃을 육안 확인했다.

**남은 것(v3)**: `MilestoneEditPopover`(228줄). 편집 대상이 작업이 아니라 마일스톤이라
인스펙터의 선택 모델을 먼저 정해야 한다 — §4 UX 표에 항목으로 적어 뒀다.

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
