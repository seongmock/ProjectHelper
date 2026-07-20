# 리팩토링 & AI 연동 결과 보고서

- 일자: 2026-07-20
- 범위: 동작 보존 리팩토링 + 버그 수정 + AI 연동(REST/OpenAPI/MCP) + E2E 검증 체계 + 스킬/문서
- 검증: **Playwright E2E 16/16 통과** (스모크 14 + AI 동기화 2) · `npm run build` 성공

## 1. 검증 체계 (신규 — 리팩토링의 전제)

리팩토링 전 기준선(baseline)으로 Playwright 스모크를 먼저 작성해 **전/후 동일 통과**로 동작 보존을 증명했다.

| 파일 | 내용 |
|---|---|
| `playwright.config.js` | vite dev 자동 기동, 순차 실행 |
| `tests/e2e/smoke.spec.js` (14) | 앱 로드, 작업 CRUD, 인라인 편집, 계층, undo/redo, 뷰 전환, 검색, 다크모드, 내보내기/가져오기 왕복, 에러 토스트, 모달 |
| `tests/e2e/ai-sync.spec.js` (2) | 외부 API 쓰기 → 10s 폴링 반영 · 편집 충돌 409 → 서버 우선 재로드 |

실행: `npx playwright test` (AI 동기화 테스트는 API 서버 미실행 시 자동 skip)

## 2. 리팩토링 (동작 보존)

### 2-1. 트리 유틸 추출 — `src/utils/taskTree.js` (신규 187줄)

App.jsx 내부 클로저로만 존재하던 재귀 트리 헬퍼 8종을 순수 함수로 추출:
`updateTaskInTree` `deleteFromTree` `addToParent` `findTaskAndParent` `isDescendant` `indentTask` `outdentTask` `regenerateIds` + 신규 `recalcTaskBounds` `recalcTaskBoundsSafe` `findOwnerOfEntity`

- **App.jsx: 1,074 → 880줄 (-194줄, -18%)**
- 중복 제거: 기간 집계(min/max) 로직 5개 사이트 → `recalcTaskBounds*` 1곳 (App 1 + TimelineBarPopover 4)
- 엔티티 소유자 3중 탐색 → `findOwnerOfEntity` 1곳
- 설정 적용 블록 2중 → `applyViewSettings` 1곳
- 서버(`server/lib/taskTree.js`)가 같은 시그니처의 CJS 미러를 사용 → 프론트/백엔드 로직 일관성

### 2-2. 데드코드 제거 (전체 -458줄 삭제 중 상당분)

- App.jsx: 미사용 `removeTask`/`insertTask` 스텁(~33줄), 사고 흔적 블록 주석 3곳
- TimelineView.jsx: 미사용 `TimelineBarPopover` import, 15줄짜리 사고 흔적 주석, 무시되는 3번째 인자 `true` 6개 사이트
- TimelineBar.jsx: 미사용 `showPeriodLabels` prop
- dateUtils.js: 미사용 `parseDate` `getToday` `isInRange` `getDaysInMonth` (-23줄)
- storage.js/htmlExporter.js: console.log debris (exporter는 **내보낸 HTML 파일에까지 포함**되던 로그)

### 2-3. 버그 수정 (동작이 바뀌는 명백한 결함 — 5건)

| # | 심각도 | 증상 → 수정 |
|---|---|---|
| 3a | High | **자기가 내보낸 파일을 가져오기 실패** — importData가 `{tasks:[...]}`를 요구하나 export는 `{meta,data}` 형식. 배열/`{data:[...]}` 허용으로 수정. E2E 왕복 테스트로 검증 |
| 3b | High | **다크모드 설정이 OS 테마에 덮어써짐** — async `loadSettings()`를 동기 호출(항상 truthy Promise). 동기 localStorage 캐시 사용으로 수정 |
| 3c | Med | **다크모드 이미지 캡처 배경이 항상 흰색** — App→TimelineView `darkMode` prop 누락. 전달 추가 |
| 3d | Med | **마운트 시 기본 설정이 서버 설정을 덮어쓰는 레이스** — 설정 저장 effect에 `isLoading` 가드 추가 |
| 3g | Low | **내보내기에 stale 설정 사용** — hook deps 누락(`snapEnabled`, `showTaskNames`, `chartTheme`) 보완 |

부수: `useToast`의 `toast` 객체를 `useMemo`로 안정화 (effect 의존성 안전).

## 3. AI 연동 (신규 기능)

> 사용법: [AI_INTEGRATION.md](./AI_INTEGRATION.md) / 설계 배경: [ARCHITECTURE.md](./ARCHITECTURE.md)

| 구성 | 파일 | 핵심 |
|---|---|---|
| 작업 단위 REST CRUD | `server/routes/tasks.js` (359줄) | 13개 엔드포인트, 필드 검증(400), 404/409, 서브트리 이동 금지 |
| 저장/리비전 레이어 | `server/lib/store.js` | 원자적 쓰기(tmp+rename), `meta.json` 리비전, 엔벨로프 오염 정규화 |
| 검증 | `server/lib/validate.js` | 의존성 없는 경량 검증 (date/color/enum 등 7종) |
| OpenAPI 3.0 | `server/openapi.yaml` | 전 엔드포인트 + 스키마 + If-Match 규약 문서화 |
| MCP 서버 | `mcp/index.js` (12개 도구) | stdio, REST 래퍼. `.mcp.json`으로 Claude Code 자동 등록 |
| 브라우저 동기화 | `storage.js` + `App.jsx` | If-Match 저장→409 시 서버 우선 재로드, 10s 리비전 폴링(`setTasksSilent` — undo 비오염) |
| dev 프록시 | `vite.config.js` | `/api` → :3000 (기존엔 dev에서 서버 연동 자체가 불가능했음) |

**해결한 핵심 문제**: 기존엔 브라우저가 마운트 시 1회만 로드하고 트리 전체를 통짜 POST → 외부(AI)가 데이터를 수정해도 열린 탭이 이를 덮어썼다. 리비전+폴링+If-Match로 AI와 브라우저가 안전하게 공존한다 (E2E로 실증).

## 4. 스킬 (신규 — `.claude/skills/`)

| 스킬 | 용도 |
|---|---|
| `timeline-api` | AI가 일정 데이터를 읽고 수정하는 방법 (MCP 우선, curl 폴백, 동시성 규약) |
| `verify-app` | 코드 변경 후 표준 검증 시퀀스 + 실패 해석표 + 테스트 작성 관례 |
| `deploy` | Docker/Caddy/로컬 배포 절차와 주의점 |

## 5. 의도적으로 하지 않은 것 (향후 과제)

동작 보존 원칙에 따라 **관찰 가능한 변화가 생기는 통합은 보류**했다:

1. **마일스톤 도형 3중 구현** (TaskRow 글리프 vs TimelineBar SVG vs exporter) — 시각적 차이가 실존해 통합 시 외형 변경
2. **타임라인 날짜 윈도우 불일치** (뷰 ±14일 vs HTML export -14/+21일) — 통합하면 차트 프레이밍이 바뀜
3. **TimelineView 내 기간 집계 3곳** — `dateUtils.formatDate`(로컬 타임존) 기반이라 `recalcTaskBounds`(UTC ISO)와 시맨틱이 달라 교체 보류
4. **TableView 날짜 컬럼 desync** — 레거시 task.startDate를 편집(타임라인은 timeRanges를 읽음). 첫 range 편집 vs 읽기 전용 중 설계 결정 필요
5. **드래그 시 undo 히스토리 오염** (expand/collapse 2엔트리) — 동작 변경이라 보류
6. **`dateUtils.formatDate`의 무시되는 format 인자** — 수정 시 툴팁 표기 변경
7. 번들 500kB+ (html2canvas) — dynamic import 분리 여지
8. TimelineBar 스냅핑 switch 2곳 — 케이스별 스냅 타입이 달라 순수 중복이 아님

## 6. 수치 요약

| 항목 | Before | After |
|---|---|---|
| App.jsx | 1,074줄 | 880줄 (-18%) |
| 소스 변경 diffstat | — | +279 / **-458줄** (기존 파일 기준) |
| 실제 버그 | 9건 발견 | 5건 수정, 4건 문서화(설계 결정 필요) |
| 자동 테스트 | 0개 | E2E 16개 (100% 통과) |
| AI 접근 수단 | 없음 (무검증 통짜 POST뿐) | REST 13 엔드포인트 + OpenAPI + MCP 12 도구 |
| 외부 변경 반영 | 페이지 새로고침 필요 + 덮어쓰기 위험 | 10초 자동 반영 + 409 충돌 보호 |
