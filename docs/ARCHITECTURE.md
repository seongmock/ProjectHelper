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
       color, description, children[], expanded, labels[], parentId,
       milestones[{id, date, label, color, shape}], dependencies[](레거시),
       divider{enabled, thickness, style, color} }
```

`data.json`은 **bare Task 배열**로 표준화됨 (과거 `{ok,data}` 엔벨로프 오염은 store.js가 읽기 시 정규화).

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

Docker Compose 3서비스: Caddy(443, basicauth, `/api/*` → api, 나머지 → 정적 프론트) + 프론트(nginx) + API(`api_data` 볼륨). `./start_server.sh` (--dev로 hot-reload overlay). 클립보드 기능은 HTTPS 전용.

## 효율성 검토 결과 (알려진 한계 / 향후 과제)

| 항목 | 상태 |
|---|---|
| 번들 >500kB 경고 | html2canvas가 대부분 — dynamic import로 분리 가능 (미적용) |
| TimelineView 1497줄 | 렌더+드래그+캡처+연결선이 한 파일 — 기능 분리 여지 |
| htmlExporter의 뷰 로직 중복 | 날짜 윈도우 패딩이 뷰(±14d)와 export(-14/+21d)로 불일치 — 통합 시 화면 변경이라 보류 |
| 마일스톤 도형 3중 구현 | TaskRow(글리프)·TimelineBar(SVG)·exporter가 각각 — 시각 차이 있어 통합 보류 |
| TableView 날짜 컬럼 | task.startDate(레거시)를 편집 — timeRanges와 desync (설계 결정 필요) |
| undo 히스토리 | 드래그 시 expand/collapse가 히스토리에 2엔트리 추가 (라이트한 불편) |
| 서버 트리 헬퍼 이중화 | server/lib/taskTree.js는 src/utils/taskTree.js의 CJS 미러 — 시그니처 변경 시 동기화 필요 |
