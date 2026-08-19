# ProjectHelper 아키텍처

> 2026-07-20 리팩토링 + AI 연동 작업 기준. 상세 변경 이력은 [REFACTORING_REPORT.md](./REFACTORING_REPORT.md), AI 연동 사용법은 [AI_INTEGRATION.md](./AI_INTEGRATION.md) 참고.

## 전체 구성

```
┌─────────────────────────────── 브라우저 ───────────────────────────────┐
│  React 18 SPA (Vite)                                                   │
│  App.jsx (중앙 상태 허브, ~880줄)                                       │
│   ├── useUndoRedo(tasks)      ← 작업 트리 + 히스토리(최대 20)           │
│   ├── useToast()              ← 전역 알림 (alert 대체)                  │
│   ├── TableView / TimelineView / split                                 │
│   └── utils/taskTree.js       ← 트리 조작 순수 함수 (불변)              │
│                                                                         │
│  utils/storage.js — 하이브리드 영속화                                   │
│   읽기: 서버 우선 → localStorage 폴백 (오프라인 동작 유지)              │
│   쓰기: localStorage 즉시 + 서버 1.5s 디바운스 (If-Match 리비전)        │
│   폴링: 10초마다 GET /api/revision → 외부 변경 시 조용히 재로드         │
└───────────────────────┬─────────────────────────────────────────────────┘
                        │ /api/*  (dev: vite proxy → :3000, prod: Caddy)
┌───────────────────────▼─────────────────────────────────────────────────┐
│  Express API (server/, CommonJS, :3000)                                 │
│   index.js          — 블롭 /api/data + settings/snapshots (하위호환)     │
│   routes/tasks.js   — 작업 단위 CRUD (AI 연동용, 검증 + If-Match/409)    │
│   lib/store.js      — 원자적 쓰기(tmp+rename) + 리비전 증가              │
│   lib/sqliteStore.js — PH_STORE=sqlite 일 때의 대체 엔진 (기본은 JSON)   │
│   lib/metrics.js     — 운영 지표 카운터 (GET /api/metrics)               │
│   lib/taskTree.js   — src/utils/taskTree.js의 CJS 미러                   │
│   lib/validate.js   — 경량 필드 검증 (외부 의존성 없음)                  │
│   데이터: server/data/{data,meta,settings,snapshots}.json               │
└───────────────────────▲─────────────────────────────────────────────────┘
                        │ HTTP (PH_API_BASE)
┌───────────────────────┴─────────────────────────────────────────────────┐
│  MCP 서버 (mcp/index.js, stdio) — Claude Code 등 AI 에이전트용           │
│  12개 도구: list/get/add/update/delete/move-task, reschedule,           │
│             add/delete-time-range, add/delete-milestone, create-snapshot │
└──────────────────────────────────────────────────────────────────────────┘
```

## 데이터 모델

Task는 재귀 트리(`children`). **날짜의 단일 진실은 `timeRanges[]`** — task 레벨 `startDate`/`endDate`는 파생 캐시이며 서버/클라이언트 모두 변경 시 재계산한다. 의존성은 range/milestone 레벨(작업 레벨 `dependencies`는 레거시, `migrateTaskData`가 첫 range로 이관 후 비움).

```
Task { id, name, timeRanges[{id, startDate, endDate, dependencies[], color, label}],
       color, description, progress(0~100), children[], expanded, labels[], parentId,
       milestones[{id, date, label, color, shape}], dependencies[](레거시),
       divider{enabled, thickness, style, color} }
```

`progress`(진행률 %)는 v1.1에 추가 — `migrateTaskData`가 구버전 데이터에 0으로 백필하고 0~100으로 클램프한다.
지연(overdue) 판정은 저장 상태가 아니라 렌더 시 `isTaskOverdue(task, today)`(taskTree.js) 순수 함수로 계산한다.

`data.json`은 **bare Task 배열**로 표준화됨 (과거 `{ok,data}` 엔벨로프 오염은 store.js가 읽기 시 정규화).

## 다중 프로젝트 (v1.5)

데이터는 프로젝트 단위로 완전 격리된다:

```
server/data/
├── projects.json              # 레지스트리 [{id, name, owner, createdAt, updatedAt}]
├── settings.json              # 전역 설정 (사용자별 설정은 v2.0 과제)
└── projects/<pid>/            # 프로젝트별: data.json + meta.json(독립 revision) + snapshots.json
```

- 라우팅: `/api/projects/:pid/{tasks,data,revision,snapshots}` (스코프) + `/api/{tasks,data,...}` (default 프로젝트 별칭 — 하위호환). 같은 라우터를 두 곳에 마운트하고 미들웨어가 `req.projectStore`를 주입.
- 부팅 시 레거시 단일 `data.json` → `projects/default/`로 멱등 마이그레이션 (`registry.ensureLayout`).
- 프로젝트 삭제는 `_trash/`로 이동 (안전망), 마지막 프로젝트는 삭제 불가(400).
- 프론트: 좌측 프로젝트 레일(`ProjectRail`) — 목록이 상시로 보이고 클릭 하나로 전환된다(2026-08-19, 실사 §5.4-11. 그전에는 헤더 드롭다운이었다). 전환 시퀀스는 (1) 디바운스 동기 취소 → (2) dirty면 이전 프로젝트 flush → (3) 스코프 전환(epoch++ — 늦은 응답 무효화) → (4) 새 데이터 로드 + **undo 히스토리 리셋**(`useUndoRedo.reset`) 순서 — 이 순서가 프로젝트 간 데이터 오염을 막는다.
- localStorage 캐시 키도 프로젝트별(`project-timeline-data:<pid>`).

### 멀티유저 대비 (기록만, 강제 없음)

Caddy basicauth 인증 사용자가 `X-Auth-User` 헤더로 전달되어 (`Caddyfile header_up`) 서버가 `req.user`로 읽고 프로젝트 `owner`·스냅샷 `createdBy`에 기록한다. 권한 강제(예: owner만 삭제)는 실제 멀티유저 도입 시 라우트에 추가하면 된다 — 구조는 준비됨. dev 환경(프록시 없음)에서는 `local`로 기록.

## 동시성 모델 (AI ↔ 브라우저)

문제: 브라우저는 트리 전체를 1.5s 디바운스로 통짜 POST → 외부(AI) 쓰기가 조용히 덮어써졌다.

해결 (리비전 + 폴링 + If-Match):
1. 모든 변경이 `server/data/meta.json`의 `revision`을 1 증가
2. 브라우저는 저장 시 `If-Match: <아는 리비전>` 전송 → 불일치면 **409** → 서버 데이터를 다시 로드(서버 우선, `setTasksSilent`라 undo 히스토리 오염 없음)
3. 브라우저는 보이는 탭에서 10초마다 `GET /api/revision` 폴링 → 변경 감지 시 조용히 재로드
4. AI는 작업 단위 엔드포인트를 사용 → 통짜 블롭 충돌 표면 자체가 없음

SSE/WebSocket 대신 폴링을 택한 이유: 단일 사용자 도구에서 10초 지연은 무해하고, Caddy 프록시 flush 설정·재연결 로직이 불필요.

## 프론트엔드 상태 흐름

- `App.jsx`가 모든 상태 소유: viewMode, 9개 뷰 설정(각 useState, localStorage 동기 캐시로 초기화 후 서버 값으로 갱신), 작업 트리(useUndoRedo)
- **`setState`(undo 기록) vs `setStateSilent`(기록 없음 — 드래그 중간, 외부 재로드)** 구분이 핵심 계약
- 트리 변경은 반드시 `src/utils/taskTree.js`의 불변 헬퍼 사용 (뮤테이션은 undo 히스토리를 오염시킴)
- 컴포넌트는 `Foo.jsx`+`Foo.css` 쌍, 다크 모드는 `[data-theme="dark"]` CSS 선택자

## 배포 토폴로지

Docker Compose 3서비스: Caddy(443, `/api/*` → api, 나머지 → 정적 프론트 — basicauth 는 2026-08-18 일시 제거) + 프론트(nginx) + API(`api_data` 볼륨). `./start_server.sh` (--dev로 hot-reload overlay). 클립보드 기능은 HTTPS 전용.

## 효율성 검토 결과 (알려진 한계 / 향후 과제)

| 항목 | 상태 |
|---|---|
| 번들 >500kB 경고 | html2canvas가 대부분 — dynamic import로 분리 가능 (미적용) |
| TimelineView 1497줄 | 렌더+드래그+캡처+연결선이 한 파일 — 기능 분리 여지 |
| htmlExporter의 뷰 로직 중복 | 2026-08-19 일부 해소 — 순수 모듈 소스를 `?raw` 로 내보낸 스크립트에 **심어서** 공유한다(`milestoneLabels.js`, `dependencyPath.js`). 남은 불일치: 날짜 윈도우 패딩이 뷰(±14d)와 export(-14/+21d)로 다름 — 통합 시 화면 변경이라 보류 |
| 마일스톤 도형 3중 구현 | TaskRow(글리프)·TimelineBar(SVG)·exporter가 각각 — 시각 차이 있어 통합 보류 |
| TableView 날짜 컬럼 | task.startDate(레거시)를 편집 — timeRanges와 desync (설계 결정 필요) |
| undo 히스토리 | 드래그 시 expand/collapse가 히스토리에 2엔트리 추가 (라이트한 불편) |
| 서버 트리 헬퍼 이중화 | server/lib/taskTree.js는 src/utils/taskTree.js의 CJS 미러 — 시그니처 변경 시 동기화 필요 |
